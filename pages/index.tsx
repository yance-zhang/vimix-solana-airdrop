import Head from 'next/head';
import { FC, useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import {
  useAirdropClaimOnSolana,
  AirdropProof,
  MerkleProofData,
} from '@/contract/solana';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

type MessageType = 'success' | 'error' | 'info' | null;

interface Message {
  type: MessageType;
  text: string;
}

const Home: FC = () => {
  const { publicKey, connected } = useWallet();
  const [message, setMessage] = useState<Message | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingProof, setIsFetchingProof] = useState(false);
  const [proofData, setProofData] = useState<AirdropProof | null>(null);
  const [isAlreadyClaimed, setIsAlreadyClaimed] = useState(false);
  const [claimedPhases, setClaimedPhases] = useState<number[]>([]);
  const { claimWithoutSignature, checkClaimed } = useAirdropClaimOnSolana();

  // Fetch proof function
  const fetchAirdropProof = async (
    walletAddress: string,
  ): Promise<AirdropProof | null> => {
    try {
      // Use Next.js API route to avoid CORS issues
      const response = await fetch('/api/fetch-proof', {
        method: 'GET',
      });

      console.log('Fetch response:', response);
      console.log('Response status:', response.status);
      console.log('Response ok:', response.ok);

      if (!response.ok) {
        throw new Error(`Failed to fetch airdrop proof: ${response.status}`);
      }

      const data: MerkleProofData = await response.json();
      console.log('JSON data fetched:', data);
      console.log('Wallet address:', walletAddress);
      console.log('Merkle root:', data.merkle_root);
      console.log(
        'Total addresses in leaves:',
        data.leaves ? Object.keys(data.leaves).length : 0,
      );

      // Check if the current wallet address exists in leaves
      const leafData = data.leaves[walletAddress];

      if (!leafData) {
        console.log('No proof found for this wallet address');
        setMessage({
          type: 'info',
          text: 'No airdrop available for this wallet.',
        });
        return null;
      }

      console.log('Proof data for wallet:', leafData);
      console.log('Amount:', leafData.amount);
      console.log('Proof array:', leafData.proof);

      // Convert MerkleProofData to AirdropProof format
      const airdropProof: AirdropProof = {
        address: walletAddress,
        total: Number(leafData.amount),
        unlocked: Number(leafData.amount),
        claimed: '0',
        detail: {},
        proofs: [
          {
            phase: 1, // Default phase is 1, adjust according to actual situation
            address: walletAddress,
            amount: Number(leafData.amount),
            index: 0,
            proof: leafData.proof,
          },
        ],
      };

      return airdropProof;
    } catch (error) {
      console.error('Fetch proof error:', error);
      setMessage({
        type: 'error',
        text: `Error fetching proof: ${error instanceof Error ? error.message : String(error)}`,
      });
      return null;
    }
  };

  // Auto-fetch proof when wallet connects
  useEffect(() => {
    const loadProof = async () => {
      if (connected && publicKey) {
        setIsFetchingProof(true);
        setProofData(null);
        setMessage(null);
        setIsAlreadyClaimed(false);
        setClaimedPhases([]);

        const proof = await fetchAirdropProof(publicKey.toBase58());

        if (proof) {
          setProofData(proof);

          // Check claim status for each phase
          if (proof.proofs && proof.proofs.length > 0) {
            const claimStatusPromises = proof.proofs.map(async (p) => {
              const claimed = await checkClaimed({
                phase: p.phase,
                ownerAddress: publicKey,
              });
              return { phase: p.phase, claimed: claimed || false };
            });

            const claimStatuses = await Promise.all(claimStatusPromises);
            const claimed = claimStatuses.filter((s) => s.claimed);
            const claimedPhaseNumbers = claimed.map((s) => s.phase);

            setClaimedPhases(claimedPhaseNumbers);

            const allClaimed = claimStatuses.every((s) => s.claimed);
            setIsAlreadyClaimed(allClaimed);

            if (allClaimed) {
              setMessage({
                type: 'info',
                text: 'All airdrops have already been claimed for this wallet.',
              });
            } else if (claimed.length > 0) {
              const totalAmount = proof.proofs
                .filter((p) => !claimedPhaseNumbers.includes(p.phase))
                .reduce((sum, p) => sum + (p.amount || 0), 0);

              setMessage({
                type: 'info',
                text: `Found ${proof.proofs.length - claimed.length} unclaimed airdrop phase(s) with total ${(totalAmount / LAMPORTS_PER_SOL).toLocaleString()} tokens available to claim! (${claimed.length} phase(s) already claimed)`,
              });
            } else {
              const totalAmount = proof.proofs.reduce((sum, p) => {
                return sum + (p.amount || 0);
              }, 0);

              setMessage({
                type: 'info',
                text: `Found ${proof.proofs.length} airdrop phase(s) with total ${(totalAmount / LAMPORTS_PER_SOL).toLocaleString()} tokens available to claim!`,
              });
            }
          } else {
            setMessage({
              type: 'info',
              text: 'No airdrop available for this wallet.',
            });
          }
        }

        setIsFetchingProof(false);
      } else {
        // Reset when wallet disconnects
        setProofData(null);
        setMessage(null);
        setIsAlreadyClaimed(false);
        setClaimedPhases([]);
      }
    };

    loadProof();
  }, [connected, publicKey]);

  const doClaim = async () => {
    if (!connected || !publicKey) {
      setMessage({
        type: 'error',
        text: 'Please connect your wallet first.',
      });
      return;
    }

    if (!proofData || !proofData.proofs || proofData.proofs.length === 0) {
      setMessage({
        type: 'error',
        text: 'No airdrop available to claim.',
      });
      return;
    }

    setIsLoading(true);

    try {
      setMessage({
        type: 'info',
        text: `Claiming ${proofData.proofs.length} airdrop(s) on Solana...`,
      });

      // Claim on Solana using claimWithoutSignature
      const txSignatures = await claimWithoutSignature({
        receiverAddress: publicKey.toBase58(),
        proofInfo: proofData,
      });

      if (txSignatures && txSignatures.length > 0) {
        setMessage({
          type: 'success',
          text: `Airdrop claimed successfully! Transaction(s): ${txSignatures.join(', ')}`,
        });

        // Refresh proof data after successful claim
        setTimeout(async () => {
          const updatedProof = await fetchAirdropProof(publicKey.toBase58());
          if (updatedProof) {
            setProofData(updatedProof);
          }
        }, 2000);
      } else {
        throw new Error('Transaction failed or was not completed');
      }
    } catch (error) {
      console.error('Claim error:', error);
      setMessage({
        type: 'error',
        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Claim Solana Airdrop</title>
      </Head>
      <div className="relative flex flex-col items-center max-w-[100vw] p-4">
        <div className="flex flex-col items-center gap-6 mt-10 w-full max-w-2xl">
          <h1 className="text-3xl font-bold">Solana Airdrop</h1>

          {/* Wallet connection button */}
          <WalletMultiButton className="!btn-primary" />

          {/* display messages */}
          {message && (
            <div
              className={`alert w-full ${
                message.type === 'success'
                  ? 'alert-success'
                  : message.type === 'error'
                    ? 'alert-error'
                    : 'alert-info'
              }`}
            >
              <div className="flex items-center gap-2 col-span-full w-full">
                {message.type === 'success' && (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="stroke-current shrink-0 h-6 w-6"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                )}
                {message.type === 'error' && (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="stroke-current shrink-0 h-6 w-6"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                )}
                <span className="break-all">{message.text}</span>
                <button
                  className="btn btn-sm btn-ghost ml-auto"
                  onClick={() => setMessage(null)}
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* Connected wallet information */}
          {connected && publicKey && (
            <div className="mt-4 p-4 bg-base-200 rounded-lg w-full">
              <p className="text-sm text-gray-600 mb-2">
                Connected Wallet Address:
              </p>
              <p className="font-mono text-sm break-all mb-4">
                {publicKey.toBase58()}
              </p>

              {isFetchingProof ? (
                <div className="flex items-center justify-center gap-2 py-4">
                  <span className="loading loading-spinner loading-md"></span>
                  <span>Loading airdrop information...</span>
                </div>
              ) : proofData &&
                proofData.proofs &&
                proofData.proofs.length > 0 ? (
                <div className="space-y-4">
                  <div className="stats stats-vertical lg:stats-horizontal shadow w-full">
                    <div className="stat">
                      <div className="stat-title">Total Claimable</div>
                      <div className="stat-value text-primary">
                        {proofData.proofs
                          .filter((p) => !claimedPhases.includes(p.phase))
                          .reduce((sum, p) => sum + (p.amount || 0), 0) /
                          LAMPORTS_PER_SOL}
                      </div>
                      <div className="stat-desc">Tokens</div>
                    </div>

                    <div className="stat">
                      <div className="stat-title">Airdrop Phases</div>
                      <div className="stat-value">
                        {
                          proofData.proofs.filter(
                            (p) => !claimedPhases.includes(p.phase),
                          ).length
                        }
                        {claimedPhases.length > 0 && (
                          <span className="text-sm ml-2">
                            / {proofData.proofs.length}
                          </span>
                        )}
                      </div>
                      <div className="stat-desc">
                        {claimedPhases.length > 0
                          ? `${claimedPhases.length} already claimed`
                          : 'Available to claim'}
                      </div>
                    </div>
                  </div>

                  <button
                    className="btn btn-primary w-full"
                    onClick={doClaim}
                    disabled={isLoading || isAlreadyClaimed}
                  >
                    {isLoading ? (
                      <>
                        <span className="loading loading-spinner"></span>
                        Processing...
                      </>
                    ) : isAlreadyClaimed ? (
                      'Already Claimed'
                    ) : (
                      'Claim Airdrop'
                    )}
                  </button>
                </div>
              ) : (
                <div className="text-center py-4 text-gray-500">
                  No airdrop available for this wallet
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default Home;
