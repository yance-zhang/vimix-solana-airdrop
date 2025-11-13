import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const response = await fetch(
      'https://raw.githubusercontent.com/Brandon-zhong/vimix-airdrop-solana/refs/heads/main/data_merkle_proofs_solana_devnet.json',
      {
        method: 'GET',
        cache: 'no-cache',
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status}`);
    }

    const data = await response.json();

    res.status(200).json(data);
  } catch (error) {
    console.error('Fetch proof error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch proof',
    });
  }
}
