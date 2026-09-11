import './styles.css';

export const metadata = {
  title: 'Inbox Appointments',
  description: 'Upcoming appointments found in connected Gmail inboxes',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Appointments',
    statusBarStyle: 'black-translucent'
  },
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg'
  }
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
