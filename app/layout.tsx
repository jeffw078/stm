import type { Metadata } from 'next';
import './globals.css';
import './modules.css';
import '@/apps/pcm/components/pcm.css';
export const metadata:Metadata={title:{default:'Painel da empresa | SteelMast',template:'%s | SteelMast'},description:'Acesso aos módulos e à gestão da empresa SteelMast.',robots:{index:false,follow:false}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="pt-BR"><body>{children}</body></html>;}
