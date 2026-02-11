import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';

export const DEVNET = false;

export const ProgramID = new PublicKey(
  '5hFNEgPoU55nCmohrdN6rGdAxqim32qtDzaMHnNiREzF', // devnet
);

export const TokenProgramId = TOKEN_2022_PROGRAM_ID;

export const MERKLE_ROOT_SEEDS = Buffer.from('merkle_root');
export const CLAIM_RECORD_SEEDS = Buffer.from('claim_record');
