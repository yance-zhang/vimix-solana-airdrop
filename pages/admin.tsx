import Head from 'next/head';
import Link from 'next/link';
import { FC, useState, useRef } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PublicKey } from '@solana/web3.js';
import GenMerkleTree from '@/utils/gen_merkle';
import {
  CreateAirdropPool,
  UpdateAirdropPoolMerkleRoot,
  withdrawUnclaimedTokens,
} from '@/contract/solana/lib';
import Papa from 'papaparse';

interface MerkleData {
  merkleRoot: string;
  leaves: Record<
    string,
    {
      amount: string;
      proof: string[];
    }
  >;
}

type MessageType = 'success' | 'error' | 'info' | 'warning';

interface Message {
  type: MessageType;
  text: string;
}

const Admin: FC = () => {
  const { publicKey, connected, signTransaction } = useWallet();
  const { connection } = useConnection();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // CSV Upload & Merkle Generation State
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<number>(1);
  const [tokenDecimals, setTokenDecimals] = useState<number>(9);
  const [merkleData, setMerkleData] = useState<MerkleData | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // Pool Creation State
  const [tokenMintAddress, setTokenMintAddress] = useState<string>('');
  const [merkleRoot, setMerkleRoot] = useState<string>('');
  const [depositAmount, setDepositAmount] = useState<string>('');
  const [poolPhase, setPoolPhase] = useState<number>(1);
  const [isCreatingPool, setIsCreatingPool] = useState(false);
  const [poolCreationResult, setPoolCreationResult] = useState<{
    phase: number;
    tokenMint: string;
    merkleRoot: string;
    depositAmount: string;
    transactionSignature: string;
    lookupTableAddress: string;
    timestamp: string;
  } | null>(null);

  // Update Merkle Root State
  const [updatePhase, setUpdatePhase] = useState<number>(1);
  const [updateTokenMint, setUpdateTokenMint] = useState<string>('');
  const [updateMerkleRoot, setUpdateMerkleRoot] = useState<string>('');
  const [isUpdatingMerkleRoot, setIsUpdatingMerkleRoot] = useState(false);

  // Withdraw Unclaimed Tokens State
  const [withdrawPhase, setWithdrawPhase] = useState<number>(1);
  const [withdrawTokenMint, setWithdrawTokenMint] = useState<string>('');
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  const [message, setMessage] = useState<Message | null>(null);

  // Show message with auto-dismiss
  const showMessage = (type: MessageType, text: string, duration = 5000) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), duration);
  };

  // Handle CSV file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.name.endsWith('.csv')) {
        showMessage('error', 'Please upload a CSV file');
        return;
      }
      setCsvFile(file);
      setMerkleData(null); // Clear previous data
    }
  };

  // Parse CSV and generate Merkle Tree
  const handleGenerateMerkleTree = async () => {
    if (!csvFile) {
      showMessage('error', 'Please upload a CSV file first');
      return;
    }

    setIsGenerating(true);

    try {
      // Parse CSV file
      Papa.parse(csvFile, {
        header: true,
        skipEmptyLines: true,
        complete: async (results: Papa.ParseResult<any>) => {
          try {
            // Convert CSV data to Record<string, number>
            const userData: Record<string, number> = {};

            for (const row of results.data as any[]) {
              const address =
                row.address || row.Address || row.wallet || row.Wallet;
              const amount = row.amount || row.Amount;

              if (!address || !amount) {
                console.warn('Skipping invalid row:', row);
                continue;
              }

              // Validate Solana address
              try {
                new PublicKey(address);
                userData[address] = parseFloat(amount);
              } catch (e) {
                console.warn('Invalid Solana address:', address);
              }
            }

            if (Object.keys(userData).length === 0) {
              showMessage(
                'error',
                'No valid data found in CSV. Please ensure your CSV has "address" and "amount" columns.',
              );
              setIsGenerating(false);
              return;
            }

            console.log(
              'Parsed user data:',
              Object.keys(userData).length,
              'entries',
            );

            // Generate Merkle Tree
            const result = await GenMerkleTree(phase, tokenDecimals, userData);
            setMerkleData(result);
            setMerkleRoot(result.merkleRoot); // Auto-fill merkle root for pool creation
            showMessage(
              'success',
              `Merkle tree generated successfully! Total users: ${Object.keys(userData).length}`,
            );
          } catch (error) {
            console.error('Error generating merkle tree:', error);
            showMessage(
              'error',
              `Error generating merkle tree: ${error instanceof Error ? error.message : String(error)}`,
            );
          } finally {
            setIsGenerating(false);
          }
        },
        error: (error: Error) => {
          console.error('Error parsing CSV:', error);
          showMessage('error', `Error parsing CSV: ${error.message}`);
          setIsGenerating(false);
        },
      });
    } catch (error) {
      console.error('Error:', error);
      showMessage(
        'error',
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      setIsGenerating(false);
    }
  };

  // Download Merkle JSON
  const handleDownloadMerkleJson = () => {
    if (!merkleData) {
      showMessage('error', 'No merkle data to download');
      return;
    }

    const dataStr = JSON.stringify(
      {
        merkle_root: merkleData.merkleRoot,
        leaves: merkleData.leaves,
      },
      null,
      2,
    );
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `merkle_tree_phase_${phase}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showMessage('success', 'Merkle tree JSON downloaded successfully!');
  };

  // Create Airdrop Pool
  const handleCreatePool = async () => {
    if (!connected || !publicKey) {
      showMessage('error', 'Please connect your wallet first');
      return;
    }

    if (!tokenMintAddress) {
      showMessage('error', 'Please enter token mint address');
      return;
    }

    if (!depositAmount || parseFloat(depositAmount) <= 0) {
      showMessage('error', 'Please enter a valid deposit amount');
      return;
    }

    // Merkle root is optional - can be empty and updated later
    const rootToUse = merkleRoot
      ? Array.from(Buffer.from(merkleRoot, 'hex'))
      : new Array(32).fill(0);

    setIsCreatingPool(true);

    try {
      const tokenMint = new PublicKey(tokenMintAddress);

      const result = await CreateAirdropPool({
        connection,
        phaseN: poolPhase,
        tokenMint,
        operator: publicKey,
        merkleRoot: new Uint8Array(rootToUse),
        depositAmount: parseFloat(depositAmount),
      });

      if (!result) {
        showMessage('error', 'Failed to create pool transaction');
        setIsCreatingPool(false);
        return;
      }

      const { tx, lookupTableAddress } = result;

      // Sign and send transaction
      if (!signTransaction) {
        showMessage('error', 'Wallet does not support transaction signing');
        setIsCreatingPool(false);
        return;
      }

      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx.feePayer = publicKey;

      const signedTx = await signTransaction(tx);
      const signature = await connection.sendRawTransaction(
        signedTx.serialize(),
      );

      console.log('Transaction signature:', signature);
      console.log('Lookup Table Address:', lookupTableAddress.toBase58());

      // Wait for confirmation
      await connection.confirmTransaction(signature, 'confirmed');

      // Save pool creation result
      const creationResult = {
        phase: poolPhase,
        tokenMint: tokenMintAddress,
        merkleRoot: merkleRoot || 'Not set (can be updated later)',
        depositAmount: depositAmount,
        transactionSignature: signature,
        lookupTableAddress: lookupTableAddress.toBase58(),
        timestamp: new Date().toISOString(),
      };
      setPoolCreationResult(creationResult);

      showMessage(
        'success',
        `Pool created successfully! Signature: ${signature.slice(0, 10)}... | LUT: ${lookupTableAddress.toBase58().slice(0, 10)}...`,
        10000,
      );

      // Reset form
      setTokenMintAddress('');
      setMerkleRoot('');
      setDepositAmount('');
    } catch (error) {
      console.error('Error creating pool:', error);
      showMessage(
        'error',
        `Error creating pool: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsCreatingPool(false);
    }
  };

  // Download Pool Creation Info
  const handleDownloadPoolInfo = () => {
    if (!poolCreationResult) {
      showMessage('error', 'No pool creation data to download');
      return;
    }

    const dataStr = JSON.stringify(poolCreationResult, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pool_info_phase_${poolCreationResult.phase}_${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showMessage('success', 'Pool creation info downloaded successfully!');
  };

  // Update Merkle Root
  const handleUpdateMerkleRoot = async () => {
    if (!connected || !publicKey) {
      showMessage('error', 'Please connect your wallet first');
      return;
    }

    if (!updateTokenMint) {
      showMessage('error', 'Please enter token mint address');
      return;
    }

    if (!updateMerkleRoot || updateMerkleRoot.trim() === '') {
      showMessage('error', 'Please enter the new merkle root');
      return;
    }

    // Validate merkle root format (should be hex string)
    if (!/^[0-9a-fA-F]{64}$/.test(updateMerkleRoot)) {
      showMessage(
        'error',
        'Invalid merkle root format. Must be a 64-character hex string.',
      );
      return;
    }

    setIsUpdatingMerkleRoot(true);

    try {
      const tokenMint = new PublicKey(updateTokenMint);
      const merkleRootBytes = new Uint8Array(
        Buffer.from(updateMerkleRoot, 'hex'),
      );

      const tx = await UpdateAirdropPoolMerkleRoot({
        connection,
        phaseN: updatePhase,
        tokenMint,
        operator: publicKey,
        merkleRoot: merkleRootBytes,
      });

      if (!tx) {
        showMessage('error', 'Failed to create update transaction');
        setIsUpdatingMerkleRoot(false);
        return;
      }

      // Sign and send transaction
      if (!signTransaction) {
        showMessage('error', 'Wallet does not support transaction signing');
        setIsUpdatingMerkleRoot(false);
        return;
      }

      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx.feePayer = publicKey;

      const signedTx = await signTransaction(tx);
      const signature = await connection.sendRawTransaction(
        signedTx.serialize(),
      );

      console.log('Update merkle root transaction signature:', signature);

      // Wait for confirmation
      await connection.confirmTransaction(signature, 'confirmed');

      showMessage(
        'success',
        `Merkle root updated successfully! Signature: ${signature.slice(0, 10)}...`,
        10000,
      );

      // Reset form
      setUpdateTokenMint('');
      setUpdateMerkleRoot('');
    } catch (error) {
      console.error('Error updating merkle root:', error);
      showMessage(
        'error',
        `Error updating merkle root: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsUpdatingMerkleRoot(false);
    }
  };

  // Withdraw Unclaimed Tokens
  const handleWithdrawTokens = async () => {
    if (!connected || !publicKey) {
      showMessage('error', 'Please connect your wallet first');
      return;
    }

    if (!withdrawTokenMint) {
      showMessage('error', 'Please enter token mint address');
      return;
    }

    setIsWithdrawing(true);

    try {
      const tokenMint = new PublicKey(withdrawTokenMint);

      const tx = await withdrawUnclaimedTokens({
        connection,
        phaseN: withdrawPhase,
        tokenMint,
        operator: publicKey,
      });

      if (!tx) {
        showMessage('error', 'Failed to create withdraw transaction');
        setIsWithdrawing(false);
        return;
      }

      // Sign and send transaction
      if (!signTransaction) {
        showMessage('error', 'Wallet does not support transaction signing');
        setIsWithdrawing(false);
        return;
      }

      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx.feePayer = publicKey;

      const signedTx = await signTransaction(tx);
      const signature = await connection.sendRawTransaction(
        signedTx.serialize(),
      );

      console.log('Withdraw transaction signature:', signature);

      // Wait for confirmation
      await connection.confirmTransaction(signature, 'confirmed');

      showMessage(
        'success',
        `Tokens withdrawn successfully! Signature: ${signature.slice(0, 10)}...`,
        10000,
      );

      // Reset form
      setWithdrawTokenMint('');
    } catch (error) {
      console.error('Error withdrawing tokens:', error);
      showMessage(
        'error',
        `Error withdrawing tokens: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsWithdrawing(false);
    }
  };

  return (
    <>
      <Head>
        <title>Airdrop Admin - Solana</title>
        <meta
          name="description"
          content="Manage airdrop pools and merkle trees"
        />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="min-h-screen bg-base-200">
        {/* Navigation */}
        <div className="navbar bg-base-100 shadow-lg">
          <div className="flex-1">
            <Link href="/" className="btn btn-ghost normal-case text-xl">
              Solana Airdrop Admin
            </Link>
          </div>
          <div className="flex-none gap-2">
            <Link href="/" className="btn btn-ghost">
              Claim Page
            </Link>
            <WalletMultiButton className="btn btn-primary" />
          </div>
        </div>

        {/* Message Alert */}
        {message && (
          <div className="fixed top-20 right-4 z-50 animate-fade-in">
            <div className={`alert alert-${message.type} shadow-lg max-w-md`}>
              <div>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="stroke-current flex-shrink-0 h-6 w-6"
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
                <span>{message.text}</span>
              </div>
            </div>
          </div>
        )}

        {/* Main Content */}
        <div className="container mx-auto p-4 max-w-6xl">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            {/* Section 1: CSV Upload & Merkle Tree Generation */}
            <div className="card bg-base-100 shadow-xl">
              <div className="card-body">
                <h2 className="card-title text-2xl mb-4">
                  Generate Merkle Tree
                </h2>
                <p className="text-sm text-base-content/70 mb-4">
                  Upload a CSV file with <code>address</code> and{' '}
                  <code>amount</code> columns to generate merkle tree
                </p>

                {/* Phase Input */}
                <div className="form-control w-full">
                  <label className="label">
                    <span className="label-text">Phase Number</span>
                  </label>
                  <input
                    type="number"
                    placeholder="1"
                    className="input input-bordered w-full"
                    value={phase}
                    onChange={(e) => setPhase(parseInt(e.target.value) || 1)}
                    min="1"
                  />
                </div>

                {/* Token Decimals Input */}
                <div className="form-control w-full">
                  <label className="label">
                    <span className="label-text">Token Decimals</span>
                  </label>
                  <input
                    type="number"
                    placeholder="9"
                    className="input input-bordered w-full"
                    value={tokenDecimals}
                    onChange={(e) =>
                      setTokenDecimals(parseInt(e.target.value) || 9)
                    }
                    min="0"
                    max="18"
                  />
                </div>

                {/* File Upload */}
                <div className="form-control w-full">
                  <label className="label">
                    <span className="label-text">CSV File</span>
                  </label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    className="file-input file-input-bordered w-full"
                    onChange={handleFileChange}
                  />
                  {csvFile && (
                    <label className="label">
                      <span className="label-text-alt text-success">
                        ✓ {csvFile.name}
                      </span>
                    </label>
                  )}
                </div>

                {/* Generate Button */}
                <button
                  className={`btn btn-primary w-full mt-4 ${isGenerating ? 'loading' : ''}`}
                  onClick={handleGenerateMerkleTree}
                  disabled={!csvFile || isGenerating}
                >
                  {isGenerating ? 'Generating...' : 'Generate Merkle Tree'}
                </button>

                {/* Merkle Data Display */}
                {merkleData && (
                  <div className="mt-6 space-y-4">
                    <div className="alert alert-success">
                      <div className="flex-col items-start w-full">
                        <div className="font-bold mb-2">
                          ✓ Merkle Tree Generated
                        </div>
                        <div className="text-xs break-all">
                          <strong>Root:</strong> {merkleData.merkleRoot}
                        </div>
                        <div className="text-xs mt-2">
                          <strong>Total Users:</strong>{' '}
                          {Object.keys(merkleData.leaves).length}
                        </div>
                      </div>
                    </div>

                    {/* Download Button */}
                    <button
                      className="btn btn-success w-full"
                      onClick={handleDownloadMerkleJson}
                    >
                      Download Merkle JSON
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Section 2: Create Airdrop Pool */}
            <div className="card bg-base-100 shadow-xl">
              <div className="card-body">
                <h2 className="card-title text-2xl mb-4">
                  Create Airdrop Pool
                </h2>
                <p className="text-sm text-base-content/70 mb-4">
                  Create a new airdrop pool and deposit tokens. Merkle root can
                  be empty and updated later.
                </p>

                {/* Connection Status */}
                {!connected && (
                  <div className="alert alert-warning shadow-lg mb-4">
                    <div>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="stroke-current flex-shrink-0 h-6 w-6"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                        />
                      </svg>
                      <span>Please connect your wallet to create a pool</span>
                    </div>
                  </div>
                )}

                {/* Pool Phase */}
                <div className="form-control w-full">
                  <label className="label">
                    <span className="label-text">Pool Phase Number</span>
                  </label>
                  <input
                    type="number"
                    placeholder="1"
                    className="input input-bordered w-full"
                    value={poolPhase}
                    onChange={(e) =>
                      setPoolPhase(parseInt(e.target.value) || 1)
                    }
                    min="1"
                  />
                </div>

                {/* Token Mint Address */}
                <div className="form-control w-full">
                  <label className="label">
                    <span className="label-text">Token Mint Address *</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Enter token mint address"
                    className="input input-bordered w-full"
                    value={tokenMintAddress}
                    onChange={(e) => setTokenMintAddress(e.target.value)}
                  />
                </div>

                {/* Merkle Root */}
                <div className="form-control w-full">
                  <label className="label">
                    <span className="label-text">Merkle Root (Optional)</span>
                    <span className="label-text-alt">Can update later</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Leave empty or paste merkle root"
                    className="input input-bordered w-full"
                    value={merkleRoot}
                    onChange={(e) => setMerkleRoot(e.target.value)}
                  />
                  <label className="label">
                    <span className="label-text-alt text-info">
                      Auto-filled if merkle tree is generated above
                    </span>
                  </label>
                </div>

                {/* Deposit Amount */}
                <div className="form-control w-full">
                  <label className="label">
                    <span className="label-text">Deposit Amount *</span>
                  </label>
                  <input
                    type="number"
                    placeholder="Enter amount to deposit"
                    className="input input-bordered w-full"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    min="0"
                    step="0.000001"
                  />
                  <label className="label">
                    <span className="label-text-alt">
                      Amount will be transferred to the pool
                    </span>
                  </label>
                </div>

                {/* Create Pool Button */}
                <button
                  className={`btn btn-primary w-full mt-4 ${isCreatingPool ? 'loading' : ''}`}
                  onClick={handleCreatePool}
                  disabled={!connected || isCreatingPool}
                >
                  {isCreatingPool
                    ? 'Creating Pool...'
                    : 'Create Pool & Deposit'}
                </button>

                {/* Info */}
                <div className="alert mt-4">
                  <div className="text-xs">
                    <p>
                      This will create a new pool and transfer the specified
                      amount to it. Make sure you have enough tokens in your
                      wallet.
                    </p>
                  </div>
                </div>

                {/* Pool Creation Result */}
                {poolCreationResult && (
                  <div className="mt-6 space-y-4">
                    <div className="alert alert-success">
                      <div className="flex-col items-start w-full">
                        <div className="font-bold mb-2">
                          ✓ Pool Created Successfully
                        </div>
                        <div className="text-xs space-y-1 w-full">
                          <div>
                            <strong>Phase:</strong> {poolCreationResult.phase}
                          </div>
                          <div className="break-all">
                            <strong>Token Mint:</strong>{' '}
                            {poolCreationResult.tokenMint}
                          </div>
                          <div className="break-all">
                            <strong>Lookup Table:</strong>{' '}
                            {poolCreationResult.lookupTableAddress}
                          </div>
                          <div>
                            <strong>Deposit Amount:</strong>{' '}
                            {poolCreationResult.depositAmount}
                          </div>
                          <div className="break-all">
                            <strong>Transaction:</strong>{' '}
                            {poolCreationResult.transactionSignature}
                          </div>
                          <div>
                            <strong>Time:</strong>{' '}
                            {new Date(
                              poolCreationResult.timestamp,
                            ).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Download Button */}
                    <button
                      className="btn btn-success w-full"
                      onClick={handleDownloadPoolInfo}
                    >
                      Download Pool Info JSON
                    </button>

                    <div className="alert alert-info">
                      <div className="text-xs">
                        <p className="font-bold mb-1">📝 Important</p>
                        <p>
                          Save this information! You&apos;ll need the{' '}
                          <strong>Lookup Table Address</strong> for claim
                          operations and the <strong>Phase Number</strong> for
                          withdraw operations.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Section 3: Update Merkle Root */}
            <div className="card bg-base-100 shadow-xl">
              <div className="card-body">
                <h2 className="card-title text-2xl mb-4">Update Merkle Root</h2>
                <p className="text-sm text-base-content/70 mb-4">
                  Update the merkle root for an existing airdrop pool. Only the
                  admin can perform this operation.
                </p>

                {/* Connection Status */}
                {!connected && (
                  <div className="alert alert-warning shadow-lg mb-4">
                    <div>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="stroke-current flex-shrink-0 h-6 w-6"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                        />
                      </svg>
                      <span>
                        Please connect your wallet to update merkle root
                      </span>
                    </div>
                  </div>
                )}

                {/* Update Phase */}
                <div className="form-control w-full">
                  <label className="label">
                    <span className="label-text">Phase Number</span>
                  </label>
                  <input
                    type="number"
                    placeholder="1"
                    className="input input-bordered w-full"
                    value={updatePhase}
                    onChange={(e) =>
                      setUpdatePhase(parseInt(e.target.value) || 1)
                    }
                    min="1"
                  />
                </div>

                {/* Token Mint Address */}
                <div className="form-control w-full">
                  <label className="label">
                    <span className="label-text">Token Mint Address *</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Enter token mint address"
                    className="input input-bordered w-full"
                    value={updateTokenMint}
                    onChange={(e) => setUpdateTokenMint(e.target.value)}
                  />
                </div>

                {/* New Merkle Root */}
                <div className="form-control w-full">
                  <label className="label">
                    <span className="label-text">New Merkle Root *</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Enter new merkle root (64-char hex)"
                    className="input input-bordered w-full font-mono text-sm"
                    value={updateMerkleRoot}
                    onChange={(e) => setUpdateMerkleRoot(e.target.value)}
                  />
                  <label className="label">
                    <span className="label-text-alt text-info">
                      Auto-filled if merkle tree is generated above
                    </span>
                  </label>
                </div>

                {/* Auto-fill from generated merkle */}
                {merkleData && merkleData.merkleRoot && (
                  <button
                    className="btn btn-sm btn-outline btn-info w-full"
                    onClick={() => setUpdateMerkleRoot(merkleData.merkleRoot)}
                  >
                    Use Generated Merkle Root
                  </button>
                )}

                {/* Update Button */}
                <button
                  className={`btn btn-warning w-full mt-4 ${isUpdatingMerkleRoot ? 'loading' : ''}`}
                  onClick={handleUpdateMerkleRoot}
                  disabled={!connected || isUpdatingMerkleRoot}
                >
                  {isUpdatingMerkleRoot ? 'Updating...' : 'Update Merkle Root'}
                </button>

                {/* Info */}
                <div className="alert alert-info mt-4">
                  <div className="text-xs">
                    <p className="font-bold mb-1">ℹ️ Note</p>
                    <p>
                      This updates the merkle root for an existing pool. Make
                      sure you have generated the new merkle tree first and the
                      pool already exists for this phase.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Section 4: Withdraw Unclaimed Tokens */}
            <div className="card bg-base-100 shadow-xl">
              <div className="card-body">
                <h2 className="card-title text-2xl mb-4">
                  Withdraw Unclaimed Tokens
                </h2>
                <p className="text-sm text-base-content/70 mb-4">
                  Withdraw all remaining tokens from an airdrop pool. Only the
                  admin can perform this operation.
                </p>

                {/* Connection Status */}
                {!connected && (
                  <div className="alert alert-warning shadow-lg mb-4">
                    <div>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="stroke-current flex-shrink-0 h-6 w-6"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                        />
                      </svg>
                      <span>Please connect your wallet to withdraw tokens</span>
                    </div>
                  </div>
                )}

                {/* Withdraw Phase */}
                <div className="form-control w-full">
                  <label className="label">
                    <span className="label-text">Phase Number</span>
                  </label>
                  <input
                    type="number"
                    placeholder="1"
                    className="input input-bordered w-full"
                    value={withdrawPhase}
                    onChange={(e) =>
                      setWithdrawPhase(parseInt(e.target.value) || 1)
                    }
                    min="1"
                  />
                </div>

                {/* Token Mint Address */}
                <div className="form-control w-full">
                  <label className="label">
                    <span className="label-text">Token Mint Address *</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Enter token mint address"
                    className="input input-bordered w-full"
                    value={withdrawTokenMint}
                    onChange={(e) => setWithdrawTokenMint(e.target.value)}
                  />
                </div>

                {/* Withdraw Button */}
                <button
                  className={`btn btn-error w-full mt-4 ${isWithdrawing ? 'loading' : ''}`}
                  onClick={handleWithdrawTokens}
                  disabled={!connected || isWithdrawing}
                >
                  {isWithdrawing ? 'Withdrawing...' : 'Withdraw All Tokens'}
                </button>

                {/* Warning */}
                <div className="alert alert-warning mt-4">
                  <div className="text-xs">
                    <p className="font-bold mb-1">⚠️ Warning</p>
                    <p>
                      This will withdraw ALL remaining tokens from the pool to
                      your wallet. This action should only be performed after
                      the airdrop period has ended.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* CSV Format Guide */}
          <div className="card bg-base-100 shadow-xl mt-6">
            <div className="card-body">
              <h3 className="card-title">CSV Format Guide</h3>
              <p className="text-sm">
                Your CSV file should have the following format:
              </p>
              <div className="mockup-code text-sm mt-2">
                <pre data-prefix="1">
                  <code>address,amount</code>
                </pre>
                <pre data-prefix="2">
                  <code>7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU,100</code>
                </pre>
                <pre data-prefix="3">
                  <code>
                    9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin,250.5
                  </code>
                </pre>
                <pre data-prefix="4">
                  <code>2BvLXmqPZY3Y1p9r7wxXHqKTmRrDcw3xKY8QZMfNVEqC,1000</code>
                </pre>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fade-in {
          animation: fade-in 0.3s ease-out;
        }
      `}</style>
    </>
  );
};

export default Admin;
