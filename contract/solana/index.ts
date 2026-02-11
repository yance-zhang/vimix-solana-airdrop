import { BN, Idl, Program, web3 } from '@coral-xyz/anchor';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  TransactionError,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import IDL from './airdrop_solana.json';
import {
  MERKLE_ROOT_SEEDS,
  CLAIM_RECORD_SEEDS,
  ProgramID,
  TokenProgramId,
} from '../constants';

// Actual format of the JSON file
export type MerkleProofData = {
  merkle_root: string;
  leaves: {
    [walletAddress: string]: {
      amount: string;
      proof: string[];
    };
  };
};

// Original AirdropProof type (backward compatible)
export type AirdropProof = {
  address: string;
  total: number;
  unlocked: number;
  claimed?: string | number;
  detail: {
    launch_agent_token?: string;
    burn_airdrop?: string;
    nft_holder?: string;
    stake_airdrop?: string;
  };
  proofs: {
    phase: number;
    address: string;
    amount: number;
    index: number;
    proof?: string[];
  }[];
  error?: string;
};

export function newTransactionWithComputeUnitPriceAndLimit(): Transaction {
  return new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({
      units: 1000000,
    }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 30000,
    }),
  );
}

export type SolSignedData = {
  signer: PublicKey;
  data: Uint8Array;
  signature: Uint8Array;
  proof: Buffer;
  expireAt: number;
};

export const useAirdropClaimOnSolana = () => {
  const { publicKey, sendTransaction, signMessage, signTransaction } =
    useWallet();
  const { connection } = useConnection();

  async function sha256(input: Uint8Array): Promise<Uint8Array> {
    const hash = await crypto.subtle.digest('SHA-256', input as any);
    return new Uint8Array(hash);
  }

  async function signClaimReward(
    proof: Buffer,
    receiver: PublicKey,
    expireAt: number,
  ): Promise<SolSignedData> {
    if (!signMessage) {
      throw new Error('Sign message function is not available');
    }
    if (!receiver || !proof || !publicKey) {
      throw new Error('No receiver or proof or signer publicKey');
    }

    const expireAtBytes = new Uint8Array(8);
    const dataView = new DataView(expireAtBytes.buffer);
    dataView.setBigInt64(0, BigInt(expireAt), true);

    const proofHash = await sha256(proof);

    const receiverBytes = receiver.toBytes();
    const data = new Uint8Array([
      ...proofHash,
      ...receiverBytes,
      ...expireAtBytes,
    ]);

    const dataHash = await sha256(data);

    const dataHashStr = Array.from(dataHash)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    console.log('dataHashStr: ', dataHashStr);
    const messageToSign = new TextEncoder().encode(dataHashStr);

    console.log('messageToSign: ', messageToSign);
    const signature = await signMessage(messageToSign);

    return {
      data: messageToSign,
      signature,
      proof,
      expireAt,
      signer: publicKey,
    };
  }

  const claimWithoutSignature = async ({
    receiverAddress,
    proofInfo,
    lutAddress,
    airdropTokenMint,
  }: {
    receiverAddress: string;
    proofInfo: AirdropProof;
    lutAddress: PublicKey;
    airdropTokenMint: PublicKey;
  }) => {
    if (!publicKey) {
      return;
    }
    // set program ID
    IDL.address = ProgramID.toBase58();
    const program = new Program(IDL as Idl, {
      connection,
    });

    const tokenAccountInfo = await connection.getAccountInfo(airdropTokenMint);
    if (!tokenAccountInfo) {
      console.log('token account info not fetch');
      return;
    }
    const tokenProgramId = tokenAccountInfo.owner;

    try {
      const userTokenVault = getAssociatedTokenAddressSync(
        airdropTokenMint,
        publicKey,
        true,
        tokenProgramId,
      );

      const txSignatureList = [];

      // handle multiple proofs
      for (let i = 0; i < proofInfo.proofs.length; i++) {
        let tx = newTransactionWithComputeUnitPriceAndLimit();
        const currentProof = proofInfo.proofs[i];
        const phase = new BN(currentProof.phase);
        const lookupTableAccountResponse =
          await connection.getAddressLookupTable(lutAddress);

        const lookupTableAccount: AddressLookupTableAccount | null =
          lookupTableAccountResponse.value;

        if (!lookupTableAccount) {
          throw new Error(
            `Unable to find address lookup table on-chain: ${lutAddress.toBase58()}`,
          );
        }

        const [merkleRoot] = PublicKey.findProgramAddressSync(
          [
            MERKLE_ROOT_SEEDS,
            phase.toArrayLike(Buffer, 'le', 1),
            airdropTokenMint.toBuffer(),
          ],
          program.programId,
        );

        const merkleTokenVault = getAssociatedTokenAddressSync(
          airdropTokenMint,
          merkleRoot,
          true,
          tokenProgramId,
        );

        const [claimRecord] = PublicKey.findProgramAddressSync(
          [
            CLAIM_RECORD_SEEDS,
            phase.toArrayLike(Buffer, 'le', 1),
            publicKey.toBuffer(),
            airdropTokenMint.toBuffer(),
          ],
          program.programId,
        );

        // use claimRecord to check if already claimed
        const accountInfo = await connection.getAccountInfo(
          new PublicKey(claimRecord),
        );
        if (accountInfo) {
          throw Error('Account Already claimed!');
        }

        const proof = (currentProof.proof as string[]).map((x) =>
          Buffer.from(x, 'hex'),
        );
        const proofBuf = Buffer.concat(proof);

        // create claim instruction
        const inst = await program.methods
          .claimAirdrop(
            phase,
            new BN(currentProof.amount), // amount
            proofBuf, // proof hash
          )
          .accounts({
            signer: publicKey,
            airdropTokenMint: airdropTokenMint,
            receiver: publicKey,
            merkleRoot: merkleRoot,
            merkleTokenVault: merkleTokenVault,
            userTokenVault: userTokenVault,
            claimAirdropRecord: claimRecord,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            tokenProgram: tokenProgramId,
            systemProgram: SystemProgram.programId,
          })
          .instruction();
        tx.add(inst);

        const { blockhash } = await connection.getLatestBlockhash();

        // convert to versioned transaction to reduce size
        const messageV0 = new TransactionMessage({
          payerKey: publicKey,
          recentBlockhash: blockhash,
          instructions: tx.instructions,
        }).compileToV0Message([lookupTableAccount]);
        const versionedTx = new VersionedTransaction(messageV0);

        try {
          console.log('--- Simulating transaction ---');
          const simulation = await connection.simulateTransaction(versionedTx);
          if (simulation.value.err) {
            console.error('❌ Simulation failed!');
            console.error('Error:', simulation.value.err);
            console.log('📜 Complete program logs:');
            simulation.value.logs?.forEach((log, i) =>
              console.log(`[${i}] ${log}`),
            );
          } else {
            console.log(
              '✅ Simulation successful! Logs:',
              simulation.value.logs,
            );
          }
        } catch (simError) {
          console.error('Error during simulation:', simError);
        }

        // Send transaction and get signature
        const signature = await sendTransaction(versionedTx, connection, {
          skipPreflight: true,
        });
        console.log(`Claim transaction sent: ${signature}`);

        txSignatureList.push(signature);
      }

      return txSignatureList;
    } catch (error: any) {
      console.error('Claim error:', error);
      throw error;
    }
  };

  const checkClaimed = async ({
    phase,
    ownerAddress,
    airdropTokenMint,
  }: {
    phase: number;
    ownerAddress: PublicKey;
    airdropTokenMint: PublicKey;
  }) => {
    if (!publicKey) {
      return;
    }
    // set program ID
    IDL.address = ProgramID.toBase58();
    const program = new Program(IDL as Idl, {
      connection,
    });

    const [claimRecord, claimRecordBump] = PublicKey.findProgramAddressSync(
      [
        CLAIM_RECORD_SEEDS,
        new BN(phase).toArrayLike(Buffer, 'le', 1),
        ownerAddress.toBuffer(),
        airdropTokenMint.toBuffer(),
      ],
      program.programId,
    );
    console.log(
      'claim record(init), bump: ',
      claimRecord.toBase58(),
      claimRecordBump,
    );

    // use claimRecord to check if already claimed
    const accountInfo = await connection.getAccountInfo(
      new PublicKey(claimRecord),
    );
    if (accountInfo) {
      // addToast('Account Already claimed', 'warning');
      return true;
    } else {
      return false;
    }
  };

  const claimAirdropWithReceiver = async ({
    proofInfo,
    signedData,
    lutAddress,
    airdropTokenMint,
  }: {
    proofInfo: AirdropProof;
    signedData: SolSignedData[];
    lutAddress: PublicKey;
    airdropTokenMint: PublicKey;
  }) => {
    if (!publicKey) {
      return;
    }
    // set program ID
    IDL.address = ProgramID.toBase58();
    const program = new Program(IDL as Idl, {
      connection,
    });

    const tokenAccountInfo = await connection.getAccountInfo(airdropTokenMint);
    if (!tokenAccountInfo) {
      console.log('token account info not fetch');
      return;
    }
    const tokenProgramId = tokenAccountInfo.owner;

    const userTokenVault = getAssociatedTokenAddressSync(
      airdropTokenMint,
      publicKey,
      true,
      tokenProgramId,
    );
    // console.log('userTokenVault: ', userTokenVault.toBase58());

    let verifyInstIdx = 2;
    const txSignatureList = [];

    // console.log('signedData: ', signedData);
    // console.log('proofInfo: ', proofInfo);

    for (let i = 0; i < proofInfo.proofs.length; i++) {
      let tx = newTransactionWithComputeUnitPriceAndLimit();
      const proof = proofInfo.proofs[i];
      const signed = signedData[i];
      const phase = new BN(proof.phase);

      // console.log('Fetching address lookup table account from chain...');
      const lookupTableAccountResponse =
        await connection.getAddressLookupTable(lutAddress);

      const lookupTableAccount: AddressLookupTableAccount | null =
        lookupTableAccountResponse.value;

      if (!lookupTableAccount) {
        throw new Error(
          `Unable to find address lookup table on-chain: ${lutAddress.toBase58()}`,
        );
      }

      const claimed = await checkClaimed({
        phase,
        ownerAddress: signed.signer,
        airdropTokenMint,
      });

      console.log('check claimed', phase.toNumber(), claimed);

      if (claimed) {
        continue;
      }

      const [merkleRoot, merkleRootBump] = PublicKey.findProgramAddressSync(
        [
          MERKLE_ROOT_SEEDS,
          phase.toArrayLike(Buffer, 'le', 1),
          airdropTokenMint.toBuffer(),
        ],
        program.programId,
      );
      console.log(
        'merkle_root(init), bump: ',
        merkleRoot.toBase58(),
        merkleRootBump,
      );

      const merkleRootInfo = await (program.account as any).merkleRoot.fetch(
        merkleRoot,
      );
      console.log('merkleRootInfo: ', JSON.stringify(merkleRootInfo));

      console.log(
        'merkleRoot: ',
        Buffer.from(merkleRootInfo.merkleRoot).toString('hex'),
      );

      const merkleTokenVault = getAssociatedTokenAddressSync(
        airdropTokenMint,
        merkleRoot,
        true,
        tokenProgramId,
      );
      console.log('merkleTokenVault: ', merkleTokenVault.toBase58());

      const [claimRecord, claimRecordBump] = PublicKey.findProgramAddressSync(
        [
          CLAIM_RECORD_SEEDS,
          phase.toArrayLike(Buffer, 'le', 1),
          signed.signer.toBuffer(),
          airdropTokenMint.toBuffer(),
        ],
        program.programId,
      );
      console.log(
        'claim record(init), bump: ',
        claimRecord.toBase58(),
        claimRecordBump,
      );

      // use claimRecord to check if already claimed
      const accountInfo = await connection.getAccountInfo(
        new PublicKey(claimRecord),
      );
      if (accountInfo) {
        console.log(
          'Account Balance:',
          accountInfo.lamports / 1_000_000_000,
          'SOL',
        );
        return;
      }

      const verifySignInst = web3.Ed25519Program.createInstructionWithPublicKey(
        {
          publicKey: signed.signer.toBytes(),
          message: signed.data,
          signature: signed.signature,
        },
      );

      tx.add(verifySignInst);

      // create claim instruction
      const inst = await program.methods
        .claimAirdropWithReceiver(
          phase,
          signed.signer,
          new BN(proof.amount), // amount
          signed.proof, // proof hash
          new BN(signed.expireAt), // expireAt
          signed.signature,
          new BN(verifyInstIdx), // verify_ix_index
        )
        .accounts({
          signer: publicKey,
          airdropTokenMint: airdropTokenMint,
          merkleRoot: merkleRoot,
          merkleTokenVault: merkleTokenVault,
          userTokenVault: userTokenVault,
          claimRecord: claimRecord,
          ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: tokenProgramId,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      tx.add(inst);

      const { blockhash } = await connection.getLatestBlockhash();

      // convert to versioned transaction to reduce size
      const messageV0 = new TransactionMessage({
        payerKey: publicKey,
        recentBlockhash: blockhash,
        instructions: tx.instructions,
      }).compileToV0Message([lookupTableAccount]);
      const versionedTx = new VersionedTransaction(messageV0);

      let txSignature = '';

      try {
        // Send transaction
        txSignature = await sendTransaction(versionedTx, connection, {
          skipPreflight: true,
        });
        console.log(`Transaction sent: ${txSignature}`);

        txSignatureList.push(txSignature);
      } catch (error: any) {
        console.error(error);
        // Handle SendTransactionError and fetch logs
        if (error.name === 'SendTransactionError') {
          const txError = error as TransactionError;
          const logs = await connection.getTransaction(txSignature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
          });
          console.error(
            'Detailed transaction logs:',
            logs?.meta?.logMessages || [],
          );
          throw new Error(
            `SendTransactionError: ${error.message}, Logs: ${JSON.stringify(logs?.meta?.logMessages || [])}`,
          );
        }
      }
    }
    return txSignatureList;
  };

  return {
    claimWithoutSignature,
    checkClaimed,
    claimAirdropWithReceiver,
    signClaimReward,
  };
};
