# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a HoloWorld airdrop checker application built with Next.js 14, supporting both Solana and BNB Chain blockchains. It allows users to check their airdrop eligibility and claim tokens.

## Key Commands

### Development
- `npm run dev` - Start development server (localhost:3000)
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint

## Architecture

### Tech Stack
- **Framework**: Next.js 14 (Pages Router)
- **Blockchain Integration**: 
  - Solana: @solana/web3.js, @coral-xyz/anchor, @solana/wallet-adapter
  - EVM (BNB Chain): wagmi, viem
- **Styling**: Tailwind CSS, DaisyUI, SASS
- **State Management**: React Context (AppStoreContext, ToastContext)
- **Data Fetching**: @tanstack/react-query, axios

### Project Structure
- `/pages` - Next.js pages (index, claim, _app)
- `/components` - React components organized by feature
- `/contract` - Smart contract integrations
  - `/solana` - Solana program interactions
  - `/bnb` - BNB Chain contract interactions
- `/api` - API client configuration
- `/context` - React context providers
- `/utils` - Utility functions and configs
- `/styles` - Global styles and SCSS files

### Key Integration Points
- **Multi-chain wallet support** via SolanaWalletProvider and WagmiProvider
- **API integration** configured in `/api/index.ts` with axios interceptors
- **Contract addresses** and ABIs in `/contract/[chain]/index.ts`
- **TypeScript path alias**: `@/` maps to project root

### Development Notes
- SSR disabled for the main App component (dynamic import)
- SVG handling configured for both inline components and URL imports
- Environment variable `NEXT_PUBLIC_API_URL` required for API endpoints