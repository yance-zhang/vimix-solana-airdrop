import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';

export const DEVNET = false;

export const ProgramID = new PublicKey(
  '5hFNEgPoU55nCmohrdN6rGdAxqim32qtDzaMHnNiREzF', // devnet
);

export const AirdropTokenMint = new PublicKey(
  '3N5Su3zJyWtTYXiyknHb1eV4T9j3RokeFyveWWizHYB9', // devnet
);

export const TokenProgramId = TOKEN_2022_PROGRAM_ID;

export const LutAddress = new PublicKey(
  'HWiYJM37xCWEFNQo3cEoxyRG7mpfyy7h5WixHZXsZrJi', // devnet phase 1
);

export const LutAddressMap: Record<number, PublicKey> = {
  1: LutAddress,
};

export const MERKLE_ROOT_SEEDS = Buffer.from('merkle_root');
export const CLAIM_RECORD_SEEDS = Buffer.from('claim_record');
