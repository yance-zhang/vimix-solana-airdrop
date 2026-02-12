import { Program } from '@coral-xyz/anchor';
import * as anchor from '@coral-xyz/anchor';
import idlJson from './airdrop_solana.json';
import {
  PublicKey,
  SystemProgram,
  AddressLookupTableProgram,
  Connection,
  Transaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  unpackMint,
  createTransferInstruction,
} from '@solana/spl-token';
import { MERKLE_ROOT_SEEDS, ProgramID } from '../constants';
import Decimal from 'decimal.js';

/**
 * Get the PDA (Program Derived Address) for an airdrop pool
 * @param phase - The phase number of the airdrop
 * @param tokenMint - The mint address of the token to be airdropped
 * @param programID - The program ID
 * @returns The PDA and bump seed for the airdrop pool
 */
function getAirdropPoolAddress(
  phase: anchor.BN,
  tokenMint: PublicKey,
  programID: PublicKey,
) {
  return PublicKey.findProgramAddressSync(
    [
      MERKLE_ROOT_SEEDS,
      phase.toArrayLike(Buffer, 'le', 1),
      tokenMint.toBuffer(),
    ],
    programID,
  );
}

/**
 * Create a new airdrop pool
 * This function initializes a new airdrop pool with a merkle root for verification,
 * creates a lookup table for efficient address storage, and optionally deposits tokens
 * @param params.connection - Solana RPC connection
 * @param params.phaseN - Phase number for this airdrop
 * @param params.tokenMint - Token mint address to be airdropped
 * @param params.operator - Admin/operator public key
 * @param params.merkleRoot - Merkle root for claim verification
 * @param params.depositAmount - Initial token deposit amount
 * @returns Transaction and lookup table address
 */
async function CreateAirdropPool(params: {
  connection: Connection;
  phaseN: number;
  tokenMint: PublicKey;
  operator: PublicKey;
  merkleRoot: Uint8Array;
  depositAmount: number;
}) {
  const phase = new anchor.BN(params.phaseN);

  const tokenAccountInfo = await params.connection.getAccountInfo(
    params.tokenMint,
  );
  if (!tokenAccountInfo) {
    console.log('Failed to fetch token account info');
    return;
  }
  const tokenProgramId = tokenAccountInfo.owner;
  const tokenDecimals = unpackMint(
    params.tokenMint,
    tokenAccountInfo,
    tokenProgramId,
  ).decimals;

  idlJson.address = ProgramID.toBase58();
  console.log('program id: ', idlJson.address);
  const program = new Program(idlJson as anchor.Idl, {
    connection: params.connection,
    publicKey: params.operator,
  });

  const [airdropPool, airdropPoolBump] = getAirdropPoolAddress(
    phase,
    params.tokenMint,
    program.programId,
  );
  console.log(
    'airdropPool(init), bump: ',
    airdropPool.toBase58(),
    airdropPoolBump,
  );

  const airdropPoolTokenVault = getAssociatedTokenAddressSync(
    params.tokenMint,
    airdropPool,
    true,
    tokenProgramId,
  );
  console.log('airdropPoolTokenVault: ', airdropPoolTokenVault.toBase58());

  let tx = new Transaction();

  // Addresses to store in the lookup table for efficient access
  const addressesToStore = [
    params.tokenMint,
    airdropPool,
    airdropPoolTokenVault,
    // Common program addresses
    anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    tokenProgramId,
    SystemProgram.programId,
  ];
  const [lookupTableInst, lookupTableAddress] =
    AddressLookupTableProgram.createLookupTable({
      authority: params.operator,
      payer: params.operator,
      recentSlot: await params.connection.getSlot(),
    });
  tx.add(lookupTableInst);

  console.log('Newly created LUT address:', lookupTableAddress.toBase58());

  // Create instruction to add addresses to the lookup table
  const extendInst = AddressLookupTableProgram.extendLookupTable({
    payer: params.operator,
    authority: params.operator,
    lookupTable: lookupTableAddress,
    addresses: addressesToStore,
  });
  tx.add(extendInst);

  // Initialize airdrop pool with merkle root
  const inst = await program.methods
    .initMerkleRoot(phase, params.merkleRoot)
    .accounts({
      admin: params.operator,
      airdropTokenMint: params.tokenMint,
      merkleRoot: airdropPool,
      merkleTokenVault: airdropPoolTokenVault,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      tokenProgram: tokenProgramId,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  tx.add(inst);

  // If deposit amount is greater than 1, add a transfer instruction
  const depositAmountD = new Decimal(params.depositAmount);
  if (depositAmountD.greaterThan(1)) {
    const userTokenVault = getAssociatedTokenAddressSync(
      params.tokenMint,
      params.operator,
      true,
      tokenProgramId,
    );

    tx.add(
      // Transfer tokens to the airdrop pool vault
      createTransferInstruction(
        userTokenVault,
        airdropPoolTokenVault,
        params.operator,
        depositAmountD.mul(10 ** tokenDecimals).toNumber(),
        [],
        tokenProgramId,
      ),
    );
  }

  return {
    tx,
    lookupTableAddress,
  };
}

/**
 * Update the merkle root of an existing airdrop pool
 * This allows the admin to update eligibility criteria for an existing airdrop
 * @param params.connection - Solana RPC connection
 * @param params.phaseN - Phase number of the airdrop pool
 * @param params.tokenMint - Token mint address
 * @param params.operator - Admin/operator public key
 * @param params.merkleRoot - New merkle root for claim verification
 * @returns Transaction to update the merkle root
 */
async function UpdateAirdropPoolMerkleRoot(params: {
  connection: Connection;
  phaseN: number;
  tokenMint: PublicKey;
  operator: PublicKey;
  merkleRoot: Uint8Array;
}) {
  const phase = new anchor.BN(params.phaseN);

  idlJson.address = ProgramID.toBase58();
  const program = new Program(idlJson as anchor.Idl, {
    connection: params.connection,
    publicKey: params.operator,
  });

  const tokenAccountInfo = await params.connection.getAccountInfo(
    params.tokenMint,
  );
  if (!tokenAccountInfo) {
    console.log('Failed to fetch token account info');
    return;
  }
  const tokenProgramId = tokenAccountInfo.owner;

  const [airdropPool, airdropPoolBump] = getAirdropPoolAddress(
    phase,
    params.tokenMint,
    program.programId,
  );
  console.log(
    'airdropPool(init), bump: ',
    airdropPool.toBase58(),
    airdropPoolBump,
  );

  const [globalAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from('global_conf')],
    program.programId,
  );
  console.log('globalAddress ', globalAddress.toBase58());

  let tx = new Transaction();

  // Create instruction to update merkle root
  const inst = await program.methods
    .updateMerkleRoot(phase, params.merkleRoot)
    .accounts({
      admin: params.operator,
      global: globalAddress,
      airdropTokenMint: params.tokenMint,
      merkleRoot: airdropPool,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      tokenProgram: tokenProgramId,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  tx.add(inst);

  return tx;
}

/**
 * Withdraw all unclaimed tokens from an airdrop pool
 * This allows the admin to recover tokens that were not claimed during the airdrop period
 * @param params.connection - Solana RPC connection
 * @param params.phaseN - Phase number of the airdrop pool
 * @param params.tokenMint - Token mint address
 * @param params.operator - Admin/operator public key
 * @returns Transaction to withdraw unclaimed tokens
 */
async function withdrawUnclaimedTokens(params: {
  connection: Connection;
  phaseN: number;
  tokenMint: PublicKey;
  operator: PublicKey;
}) {
  const phase = new anchor.BN(params.phaseN);
  const tokenAccountInfo = await params.connection.getAccountInfo(
    params.tokenMint,
  );
  if (!tokenAccountInfo) {
    console.log('Failed to fetch token account info');
    return;
  }
  const tokenProgramId = tokenAccountInfo.owner;

  idlJson.address = ProgramID.toBase58();
  const program = new Program(idlJson as anchor.Idl, {
    connection: params.connection,
    publicKey: params.operator,
  });

  const [airdropPool, airdropPoolBump] = getAirdropPoolAddress(
    phase,
    params.tokenMint,
    program.programId,
  );
  console.log('airdropPool ', airdropPool.toBase58());

  const [globalAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from('global_conf')],
    program.programId,
  );
  console.log('globalAddress ', globalAddress.toBase58());

  const airdropPoolTokenVault = getAssociatedTokenAddressSync(
    params.tokenMint,
    airdropPool,
    true,
    tokenProgramId,
  );
  console.log('airdrop pool token vault ', airdropPoolTokenVault.toBase58());

  const userTokenVault = getAssociatedTokenAddressSync(
    params.tokenMint,
    params.operator,
    true,
    tokenProgramId,
  );
  console.log('user token vault ', userTokenVault.toBase58());

  let tx = new Transaction();

  // Create instruction to withdraw unclaimed tokens
  const inst = await program.methods
    .withdrawUnclaimedTokens(phase)
    .accounts({
      admin: params.operator,
      global: globalAddress,
      airdropTokenMint: params.tokenMint,
      merkleRoot: airdropPool,
      merkleTokenVault: airdropPoolTokenVault,
      userTokenVault: userTokenVault,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      tokenProgram: tokenProgramId,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  tx.add(inst);

  return tx;
}

export {
  CreateAirdropPool,
  UpdateAirdropPoolMerkleRoot,
  withdrawUnclaimedTokens,
};
