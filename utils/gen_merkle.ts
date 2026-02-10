import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { MerkleTree } from "merkletreejs";
import * as CryptoJS from "crypto-js";
import Decimal from "decimal.js";

export function leavesData(
    phase: number,
    user: PublicKey,
    amount: bigint
): Buffer {
    const data = Buffer.alloc(41);
    data.writeUInt8(phase, 0);
    data.set(user.toBytes(), 1);
    data.writeBigUint64LE(amount, 33);
    // const data = Buffer.concat([user.toBytes(), amount]);
    // console.log("data: ", [...data]);
    return sha256(data);
}

export function sha256(input: Buffer): Buffer {
    const wordArray = CryptoJS.lib.WordArray.create(input);
    const hash = CryptoJS.SHA256(wordArray).toString(CryptoJS.enc.Hex);
    const hashBuffer = Buffer.from(hash, "hex");
    return hashBuffer;
}

async function GenMerkleTree(phase: number, tokenDecimals: number, userData: Record<string, number>) {
    interface userDataBO {
        amount: anchor.BN
        leaves: Buffer
    }

    var total = new Decimal(0);
    const userAmountsBN: Record<string, userDataBO> = Object.fromEntries(
        Object.entries(userData).map(([key, value]) => {
            const lamports = new Decimal(value).mul(new Decimal(10).pow(tokenDecimals));

            const leaves = leavesData(
                phase,
                new PublicKey(key),
                BigInt(lamports.toFixed())
            );

            total = total.add(lamports);
            return [key, {
                amount: new anchor.BN(lamports.toFixed(0)),
                leaves: leaves,
            }];
        })
    );

    console.log(
        "total users: ",
        Object.keys(userAmountsBN).length,
        "total amount: ",
        total.toString()
    );

    const leaves_hash = Object.values(userAmountsBN).map(v => v.leaves);

    // Create Merkle Tree
    const tree = new MerkleTree(leaves_hash, sha256, { sortPairs: true });

    // Get the root of the tree

    const root = tree.getRoot().toString("hex");
    // console.log("merkle root", [...tree.getRoot()]);
    console.log("Merkle Root:", root);

    const userProofs = Object.fromEntries(Object.entries(userAmountsBN).map(([address, data]) => {
        const proof = tree
            .getProof(data.leaves)
            .map((x) => x.data.toString("hex"));

        return [address, {
            amount: data.amount.toString(),
            proof: proof,
        }];

    }));

    return {
        merkleRoot: root,
        leaves: userProofs,
    }
}


