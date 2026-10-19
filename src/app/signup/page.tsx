import { Suspense } from 'react';
import { AuthForm } from '@/components/AuthForm';
export const metadata = { title: 'Join' };
export default function Signup() {
  return <div className="container"><Suspense><AuthForm mode="signup" /></Suspense></div>;
}
