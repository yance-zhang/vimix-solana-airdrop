import Head from 'next/head';
import Link from 'next/link';
import { FC, useState, useEffect, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import {
  useAirdropClaimOnSolana,
  AirdropProof,
  MerkleProofData,
} from '@/contract/solana';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

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
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<number>(1);
  const [tokenMintAddress, setTokenMintAddress] = useState<string>('');
  const [lutAddress, setLutAddress] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const poolInfoFileInputRef = useRef<HTMLInputElement>(null);
  const { claimWithoutSignature, checkClaimed } = useAirdropClaimOnSolana();

  // Handle pool info JSON upload
  const handlePoolInfoUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.json')) {
      setMessage({
        type: 'error',
        text: 'Please upload a JSON file',
      });
      return;
    }

    try {
      const fileContent = await file.text();
      const poolInfo = JSON.parse(fileContent);

      // Validate pool info structure
      if (
        !poolInfo.phase ||
        !poolInfo.tokenMint ||
        !poolInfo.lookupTableAddress
      ) {
        setMessage({
          type: 'error',
          text: 'Invalid pool info JSON format. Missing required fields.',
        });
        return;
      }

      // Auto-fill fields
      setPhase(poolInfo.phase);
      setTokenMintAddress(poolInfo.tokenMint);
      setLutAddress(poolInfo.lookupTableAddress);

      setMessage({
        type: 'success',
        text: `Pool info loaded! Phase: ${poolInfo.phase}, Token Mint: ${poolInfo.tokenMint.slice(0, 8)}...`,
      });
    } catch (error) {
      console.error('Error reading pool info file:', error);
      setMessage({
        type: 'error',
        text: `Error reading pool info file: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  };

  // Parse uploaded JSON file and extract proof for wallet
  const parseProofFromJson = async (
    jsonData: MerkleProofData,
    walletAddress: string,
    phaseNumber: number,
  ): Promise<AirdropProof | null> => {
    try {
      console.log('Parsing JSON data for wallet:', walletAddress);
      console.log('Merkle root:', jsonData.merkle_root);
      console.log(
        'Total addresses in leaves:',
        jsonData.leaves ? Object.keys(jsonData.leaves).length : 0,
      );

      // Check if the current wallet address exists in leaves
      const leafData = jsonData.leaves[walletAddress];

      if (!leafData) {
        console.log('No proof found for this wallet address');
        setMessage({
          type: 'info',
          text: 'No airdrop available for this wallet in the uploaded file.',
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
            phase: phaseNumber,
            address: walletAddress,
            amount: Number(leafData.amount),
            index: 0,
            proof: leafData.proof,
          },
        ],
      };

      return airdropProof;
    } catch (error) {
      console.error('Parse proof error:', error);
      setMessage({
        type: 'error',
        text: `Error parsing proof: ${error instanceof Error ? error.message : String(error)}`,
      });
      return null;
    }
  };

  // Handle file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.json')) {
      setMessage({
        type: 'error',
        text: 'Please upload a JSON file',
      });
      return;
    }

    if (!connected || !publicKey) {
      setMessage({
        type: 'error',
        text: 'Please connect your wallet first',
      });
      return;
    }

    if (!tokenMintAddress || tokenMintAddress.trim() === '') {
      setMessage({
        type: 'error',
        text: 'Please enter the Token Mint Address first',
      });
      return;
    }

    let tokenMintPublicKey: PublicKey;
    try {
      tokenMintPublicKey = new PublicKey(tokenMintAddress);
    } catch (error) {
      setMessage({
        type: 'error',
        text: 'Invalid Token Mint Address format',
      });
      return;
    }

    setUploadedFile(file);
    setIsFetchingProof(true);
    setProofData(null);
    setMessage(null);
    setIsAlreadyClaimed(false);
    setClaimedPhases([]);

    try {
      // Read and parse JSON file
      const fileContent = await file.text();
      const jsonData: MerkleProofData = JSON.parse(fileContent);

      const proof = await parseProofFromJson(
        jsonData,
        publicKey.toBase58(),
        phase,
      );

      if (proof) {
        setProofData(proof);

        // Check claim status for each phase
        if (proof.proofs && proof.proofs.length > 0) {
          const claimStatusPromises = proof.proofs.map(async (p) => {
            const claimed = await checkClaimed({
              phase: p.phase,
              ownerAddress: publicKey,
              airdropTokenMint: tokenMintPublicKey,
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
        }
      }
    } catch (error) {
      console.error('Error reading file:', error);
      setMessage({
        type: 'error',
        text: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setIsFetchingProof(false);
    }
  };

  // Reset state when wallet disconnects
  useEffect(() => {
    if (!connected) {
      setProofData(null);
      setMessage(null);
      setIsAlreadyClaimed(false);
      setClaimedPhases([]);
      setUploadedFile(null);
      setPhase(1);
      setLutAddress('');
    }
  }, []);

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

    if (!tokenMintAddress || tokenMintAddress.trim() === '') {
      setMessage({
        type: 'error',
        text: 'Please enter the Token Mint Address.',
      });
      return;
    }

    if (!lutAddress || lutAddress.trim() === '') {
      setMessage({
        type: 'error',
        text: 'Please enter the Lookup Table Address.',
      });
      return;
    }

    let tokenMintPublicKey: PublicKey;
    let lutPublicKey: PublicKey;
    try {
      tokenMintPublicKey = new PublicKey(tokenMintAddress);
      lutPublicKey = new PublicKey(lutAddress);
    } catch (error) {
      setMessage({
        type: 'error',
        text: 'Invalid Token Mint or Lookup Table Address format.',
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
        lutAddress: lutPublicKey,
        airdropTokenMint: tokenMintPublicKey,
      });

      if (txSignatures && txSignatures.length > 0) {
        setMessage({
          type: 'success',
          text: `Airdrop claimed successfully! Transaction(s): ${txSignatures.join(', ')}`,
        });
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

          {/* connect wallet */}
          <WalletMultiButton />

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

              {/* Pool Info Upload Section */}
              <div className="mb-6 p-4 bg-base-300 rounded-lg">
                <label className="label">
                  <span className="label-text font-semibold">
                    Quick Setup: Upload Pool Info JSON
                  </span>
                </label>
                <input
                  ref={poolInfoFileInputRef}
                  type="file"
                  accept=".json"
                  className="file-input file-input-bordered file-input-sm w-full"
                  onChange={handlePoolInfoUpload}
                />
                <label className="label">
                  <span className="label-text-alt text-info">
                    Upload the pool info JSON file to auto-fill Phase, Token
                    Mint, and LUT Address
                  </span>
                </label>
              </div>

              <div className="divider">OR enter manually</div>

              {/* Token Mint Address Input */}
              <div className="mb-4">
                <label className="label">
                  <span className="label-text font-semibold">
                    Token Mint Address
                  </span>
                </label>
                <input
                  type="text"
                  placeholder="Enter Token Mint Address"
                  className="input input-bordered w-full"
                  value={tokenMintAddress}
                  onChange={(e) => setTokenMintAddress(e.target.value)}
                />
                <label className="label">
                  <span className="label-text-alt text-gray-500">
                    Enter the airdrop token mint address
                  </span>
                </label>
              </div>

              {/* Phase Input */}
              <div className="mb-4">
                <label className="label">
                  <span className="label-text font-semibold">Phase Number</span>
                </label>
                <input
                  type="number"
                  placeholder="Enter phase number"
                  className="input input-bordered w-full"
                  value={phase}
                  onChange={(e) => setPhase(parseInt(e.target.value) || 1)}
                  min="1"
                />
                <label className="label">
                  <span className="label-text-alt text-gray-500">
                    Enter the airdrop phase number (usually starts from 1)
                  </span>
                </label>
              </div>

              {/* LUT Address Input */}
              <div className="mb-4">
                <label className="label">
                  <span className="label-text font-semibold">
                    Lookup Table Address
                  </span>
                </label>
                <input
                  type="text"
                  placeholder="Enter Lookup Table Address"
                  className="input input-bordered w-full"
                  value={lutAddress}
                  onChange={(e) => setLutAddress(e.target.value)}
                />
                <label className="label">
                  <span className="label-text-alt text-gray-500">
                    Enter the address lookup table public key for the airdrop
                    phase
                  </span>
                </label>
              </div>

              {/* File Upload Section */}
              <div className="mb-6">
                <label className="label">
                  <span className="label-text font-semibold">
                    Upload Merkle Proof JSON
                  </span>
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  className="file-input file-input-bordered w-full"
                  onChange={handleFileUpload}
                />
                {uploadedFile && (
                  <label className="label">
                    <span className="label-text-alt text-success">
                      ✓ {uploadedFile.name}
                    </span>
                  </label>
                )}
                <label className="label">
                  <span className="label-text-alt text-gray-500">
                    Please upload the merkle proof JSON file to check your
                    airdrop eligibility
                  </span>
                </label>
              </div>

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
                    disabled={
                      isLoading ||
                      isAlreadyClaimed ||
                      !tokenMintAddress ||
                      !lutAddress
                    }
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
              ) : uploadedFile ? (
                <div className="text-center py-4 text-gray-500">
                  No airdrop available for this wallet in the uploaded file
                </div>
              ) : (
                <div className="text-center py-4 text-gray-500">
                  Please upload a merkle proof JSON file to check eligibility
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
