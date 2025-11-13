import { SolanaWalletProvider } from '@/components/SolanaWalletProvider';
import '@/styles/global.scss';
import clsx from 'clsx';
import { AppProps } from 'next/app';
import dynamic from 'next/dynamic';
import { Inter } from 'next/font/google';
import Head from 'next/head';
import 'normalize.css/normalize.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

const App = ({ Component, pageProps, router }: AppProps) => {
  return (
    <main className={clsx(inter.variable, 'font-inter')}>
      <SolanaWalletProvider>
        <Head>
          <meta
            name="viewport"
            content="width=device-width,minimum-scale=1,maximum-scale=1,user-scalable=no"
          />
          <link rel="icon" href="/favicon.ico" sizes="any" />
        </Head>
        <Component {...pageProps} />
      </SolanaWalletProvider>
    </main>
  );
};

export default dynamic(() => Promise.resolve(App), { ssr: false });
