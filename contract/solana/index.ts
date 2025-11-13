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
import IDL from './holo_token_airdrop_solana.json';
import {
  MERKLE_ROOT_SEEDS,
  CLAIM_RECORD_SEEDS,
  ProgramID,
  TokenProgramId,
  AirdropTokenMint,
  LutAddressMap,
} from '../constants';

// JSON文件的实际格式
export type MerkleProofData = {
  merkle_root: string;
  leaves: {
    [walletAddress: string]: {
      amount: string;
      proof: string[];
    };
  };
};

// 原有的AirdropProof类型（向后兼容）
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
  }: {
    receiverAddress: string;
    proofInfo: AirdropProof;
  }) => {
    if (!publicKey) {
      return;
    }
    IDL.address = ProgramID.toBase58();
    const program = new Program(IDL as Idl, {
      connection,
    });

    try {
      const userTokenVault = getAssociatedTokenAddressSync(
        AirdropTokenMint,
        publicKey,
        true,
        TOKEN_2022_PROGRAM_ID,
      );

      let tx = newTransactionWithComputeUnitPriceAndLimit();
      const txSignatureList = [];
      for (let i = 0; i < proofInfo.proofs.length; i++) {
        const currentProof = proofInfo.proofs[i];

        const phase = new BN(currentProof.phase);

        const lookupTableAccountResponse =
          await connection.getAddressLookupTable(LutAddressMap[phase]);

        const lookupTableAccount: AddressLookupTableAccount | null =
          lookupTableAccountResponse.value;

        if (!lookupTableAccount) {
          throw new Error(
            `Unable to find address lookup table on-chain: ${LutAddressMap[phase].toBase58()}`,
          );
        }

        const [merkleRoot] = PublicKey.findProgramAddressSync(
          [
            MERKLE_ROOT_SEEDS,
            phase.toArrayLike(Buffer, 'le', 1),
            AirdropTokenMint.toBuffer(),
          ],
          program.programId,
        );

        const merkleTokenVault = getAssociatedTokenAddressSync(
          AirdropTokenMint,
          merkleRoot,
          true,
          TOKEN_2022_PROGRAM_ID,
        );

        const [claimRecord] = PublicKey.findProgramAddressSync(
          [
            CLAIM_RECORD_SEEDS,
            phase.toArrayLike(Buffer, 'le', 1),
            publicKey.toBuffer(),
            AirdropTokenMint.toBuffer(),
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

        const inst = await program.methods
          .claimAirdrop(
            phase,
            new BN(currentProof.amount), // amount
            proofBuf, // proof hash
          )
          .accounts({
            signer: publicKey,
            airdropTokenMint: AirdropTokenMint,
            receiver: publicKey,
            merkleRoot: merkleRoot,
            merkleTokenVault: merkleTokenVault,
            userTokenVault: userTokenVault,
            claimRecord: claimRecord,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .instruction();
        tx.add(inst);

        const { blockhash } = await connection.getLatestBlockhash();

        const messageV0 = new TransactionMessage({
          payerKey: publicKey,
          recentBlockhash: blockhash,
          instructions: tx.instructions,
        }).compileToV0Message([lookupTableAccount]);

        const versionedTx = new VersionedTransaction(messageV0);

        let txSignature = '';

        // Send transaction using Privy's sendTransaction
        const receipt = await sendTransaction(versionedTx, connection);
        txSignature = receipt;

        txSignatureList.push(txSignature);
      }

      return txSignatureList;
    } catch (error: any) {
      console.error(error);
      return null;
    }
  };

  const checkClaimed = async ({
    phase,
    ownerAddress,
  }: {
    phase: number;
    ownerAddress: PublicKey;
  }) => {
    if (!publicKey) {
      return;
    }

    IDL.address = ProgramID.toBase58();
    const program = new Program(IDL as Idl, {
      connection,
    });

    const [claimRecord, claimRecordBump] = PublicKey.findProgramAddressSync(
      [
        CLAIM_RECORD_SEEDS,
        new BN(phase).toArrayLike(Buffer, 'le', 1),
        ownerAddress.toBuffer(),
        AirdropTokenMint.toBuffer(),
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
  }: {
    proofInfo: AirdropProof;
    signedData: SolSignedData[];
  }) => {
    if (!publicKey) {
      return;
    }

    IDL.address = ProgramID.toBase58();
    const program = new Program(IDL as Idl, {
      connection,
    });

    const userTokenVault = getAssociatedTokenAddressSync(
      AirdropTokenMint,
      publicKey,
      true,
      TokenProgramId,
    );
    console.log('userTokenVault: ', userTokenVault.toBase58());

    let tx = newTransactionWithComputeUnitPriceAndLimit();

    let verifyInstIdx = 2;
    const txSignatureList = [];

    // console.log('signedData: ', signedData);
    // console.log('proofInfo: ', proofInfo);

    for (let i = 0; i < proofInfo.proofs.length; i++) {
      const proof = proofInfo.proofs[i];
      const signed = signedData[i];
      const phase = new BN(proof.phase);

      // console.log('正在从链上获取地址查找表账户...');
      const lookupTableAccountResponse = await connection.getAddressLookupTable(
        LutAddressMap[phase],
      );

      const lookupTableAccount: AddressLookupTableAccount | null =
        lookupTableAccountResponse.value;

      if (!lookupTableAccount) {
        throw new Error(
          `无法在链上找到地址查找表: ${LutAddressMap[phase].toBase58()}`,
        );
      }

      const claimed = await checkClaimed({
        phase,
        ownerAddress: signed.signer,
      });

      console.log('check claimed', phase.toNumber(), claimed);

      if (claimed) {
        continue;
      }

      const [merkleRoot, merkleRootBump] = PublicKey.findProgramAddressSync(
        [
          MERKLE_ROOT_SEEDS,
          phase.toArrayLike(Buffer, 'le', 1),
          AirdropTokenMint.toBuffer(),
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
        AirdropTokenMint,
        merkleRoot,
        true,
        TOKEN_2022_PROGRAM_ID,
      );
      console.log('merkleTokenVault: ', merkleTokenVault.toBase58());

      const [claimRecord, claimRecordBump] = PublicKey.findProgramAddressSync(
        [
          CLAIM_RECORD_SEEDS,
          phase.toArrayLike(Buffer, 'le', 1),
          signed.signer.toBuffer(),
          AirdropTokenMint.toBuffer(),
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
          airdropTokenMint: AirdropTokenMint,
          merkleRoot: merkleRoot,
          merkleTokenVault: merkleTokenVault,
          userTokenVault: userTokenVault,
          claimRecord: claimRecord,
          ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      tx.add(inst);

      const { blockhash } = await connection.getLatestBlockhash();

      // console.log(`blockhash: ${blockhash}`);

      const messageV0 = new TransactionMessage({
        payerKey: publicKey,
        recentBlockhash: blockhash,
        instructions: tx.instructions,
      }).compileToV0Message([lookupTableAccount]);

      const versionedTx = new VersionedTransaction(messageV0);
      const serializedTx = versionedTx.serialize();
      const txSize = serializedTx.length;

      // console.log(`✅ 这笔版本化交易的大小是: ${txSize} 字节`);

      let txSignature = '';

      try {
        // Sign transaction with wallet
        // if (!signTransaction) {
        //   throw new Error('Wallet does not support transaction signing');
        // }
        // const signedTx = await signTransaction(versionedTx);

        // console.log(signedTx);

        // Send transaction
        txSignature = await sendTransaction(versionedTx, connection, {
          skipPreflight: true,
        });
        console.log(`Transaction sent: ${txSignature}`);

        // Confirm transaction
        // const confirmation = await connection.confirmTransaction(
        //   txSignature,
        //   'confirmed',
        // );
        // console.log('Transaction confirmed:', confirmation);

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
