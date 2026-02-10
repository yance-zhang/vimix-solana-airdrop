import { Program } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import idlJson from './airdrop_solana.json';
import {
    PublicKey,
    SystemProgram,
    AddressLookupTableProgram,
    Connection,
    Transaction,
} from "@solana/web3.js";
import {
    getAssociatedTokenAddressSync,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    unpackMint,
    createTransferInstruction,
} from "@solana/spl-token";
import {
    MERKLE_ROOT_SEEDS,
    ProgramID,
} from "../constants";
import Decimal from "decimal.js";


function getAirdropPoolAddress(phase: anchor.BN, tokenMint: PublicKey, programID: PublicKey) {
    return PublicKey.findProgramAddressSync(
        [
            MERKLE_ROOT_SEEDS,
            phase.toArrayLike(Buffer, "le", 1),
            tokenMint.toBuffer(),
        ],
        programID
    );
}

// 创建一个新的空投池
async function CreateAirdropPool(params: {
    connection: Connection;
    phaseN: number;
    tokenMint: PublicKey;
    operator: PublicKey;
    merkleRoot: Uint8Array;
    depositAmount: number;
}) {

    const phase = new anchor.BN(params.phaseN);


    const tokenAccountInfo = await params.connection.getAccountInfo(params.tokenMint);
    if (!tokenAccountInfo) {
        console.log("token account info not fetch");
        return
    }
    const tokenProgramId = tokenAccountInfo.owner;
    const tokenDecimals = unpackMint(params.tokenMint, tokenAccountInfo, tokenProgramId).decimals

    idlJson.address = ProgramID.toBase58();
    console.log("program id: ", idlJson.address);
    const program = new Program(idlJson as anchor.Idl, {
        connection: params.connection,
        publicKey: params.operator,
    });

    const [airdropPool, airdropPoolBump] = getAirdropPoolAddress(phase, params.tokenMint, program.programId);
    console.log(
        "airdropPool(init), bump: ",
        airdropPool.toBase58(),
        airdropPoolBump
    );

    const airdropPoolTokenVault = getAssociatedTokenAddressSync(
        params.tokenMint,
        airdropPool,
        true,
        tokenProgramId
    );
    console.log("airdropPoolTokenVault: ", airdropPoolTokenVault.toBase58());

    let tx = new Transaction();

    const addressesToStore = [
        params.tokenMint,
        airdropPool,
        airdropPoolTokenVault,
        // 常用程序地址
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

    console.log("新创建的 LUT 地址:", lookupTableAddress.toBase58());

    // 3. 创建一个向 LUT 添加地址的指令
    const extendInst = AddressLookupTableProgram.extendLookupTable({
        payer: params.operator,
        authority: params.operator,
        lookupTable: lookupTableAddress,
        addresses: addressesToStore,
    });
    tx.add(extendInst);

    // initialize global state
    const inst = await program.methods
        .initMerkleRoot(
            phase,
            params.merkleRoot
        )
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


    // 如果 deposit amount 大于 1，增加一个转账的指令
    const depositAmountD = new Decimal(params.depositAmount);
    if (depositAmountD.greaterThan(1)) {

        const userTokenVault = getAssociatedTokenAddressSync(
            params.tokenMint,
            params.operator,
            true,
            tokenProgramId
        );

        tx.add(
            // trasnfer token
            createTransferInstruction(
                userTokenVault,
                airdropPoolTokenVault,
                params.operator,
                depositAmountD.mul(10 ** tokenDecimals).toNumber(),
                [],
                tokenProgramId
            )
        );
    }

    return {
        tx,
        lookupTableAddress
    }
}

// 更新已经有池子的 merkle root
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

    const tokenAccountInfo = await params.connection.getAccountInfo(params.tokenMint);
    if (!tokenAccountInfo) {
        console.log("token account info not fetch");
        return
    }
    const tokenProgramId = tokenAccountInfo.owner;

    const [airdropPool, airdropPoolBump] = getAirdropPoolAddress(phase, params.tokenMint, program.programId);
    console.log(
        "airdropPool(init), bump: ",
        airdropPool.toBase58(),
        airdropPoolBump
    );

    let tx = new Transaction();

    // initialize global state
    const inst = await program.methods
        .updateMerkleRoot(
            phase,
            params.merkleRoot
        )
        .accounts({
            admin: params.operator,
            airdropTokenMint: params.tokenMint,
            merkleRoot: airdropPool,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            tokenProgram: tokenProgramId,
            systemProgram: SystemProgram.programId,
        })
        .instruction();
    tx.add(inst);

    return tx
}

// 提取池子里剩下的全部资金
async function withdrawUnclaimedTokens(params: {
    connection: Connection;
    phaseN: number;
    tokenMint: PublicKey;
    operator: PublicKey;
}) {

    const phase = new anchor.BN(params.phaseN);
    const tokenAccountInfo = await params.connection.getAccountInfo(params.tokenMint);
    if (!tokenAccountInfo) {
        console.log("token account info not fetch");
        return
    }
    const tokenProgramId = tokenAccountInfo.owner;

    idlJson.address = ProgramID.toBase58();
    const program = new Program(idlJson as anchor.Idl, {
        connection: params.connection,
        publicKey: params.operator,
    });

    const [airdropPool, airdropPoolBump] = getAirdropPoolAddress(phase, params.tokenMint, program.programId);;

    const airdropPoolTokenVault = getAssociatedTokenAddressSync(
        params.tokenMint,
        airdropPool,
        true,
        tokenProgramId
    );


    const userTokenVault = getAssociatedTokenAddressSync(
        params.tokenMint,
        params.operator,
        true,
        tokenProgramId
    );


    let tx = new Transaction();

    const inst = await program.methods
        .withdrawUnclaimedTokens(phase)
        .accounts({
            admin: params.operator,
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