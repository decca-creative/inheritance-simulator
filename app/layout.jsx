export const metadata = {
  title: '相続税シミュレーター',
  description: '相続税を簡単に計算できるシミュレーターです',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
