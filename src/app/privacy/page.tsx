import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy",
  description: "How the Re-Love public preview handles information.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 sm:py-20">
      <Link href="/" className="text-sm text-[#8CB9FF] underline underline-offset-4">
        Back to Re-Love
      </Link>
      <p className="mt-12 text-sm uppercase tracking-widest text-[#9AA4B8]">Public preview</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">Privacy</h1>
      <p className="mt-4 text-[#9AA4B8]">Last updated: November 1, 2026</p>

      <div className="mt-10 space-y-9 text-base leading-8 text-[#9AA4B8]">
        <section>
          <h2 className="mb-3 text-xl font-semibold text-[#F5F5F7]">About this preview</h2>
          <p>
            Re-Love is a student marketplace in development. This public preview explains
            the project. It does not currently offer account creation, sign-in, listings,
            photo uploads, or messaging, and it does not request access to your Google account.
          </p>
        </section>
        <section>
          <h2 className="mb-3 text-xl font-semibold text-[#F5F5F7]">Information when you visit</h2>
          <p>
            This preview has no forms and no advertising or analytics scripts added by
            Re-Love. Our hosting provider, Vercel, may process technical request information,
            such as your IP address, browser information, and requested page, to deliver
            and protect the website. Visit Vercel&apos;s privacy policy for information about
            its processing.
          </p>
          <a href="https://vercel.com/legal/privacy-policy" className="mt-3 inline-block text-[#8CB9FF] underline underline-offset-4">
            Vercel privacy policy
          </a>
        </section>
        <section>
          <h2 className="mb-3 text-xl font-semibold text-[#F5F5F7]">Before the marketplace opens</h2>
          <p>
            Google sign-in is planned for the marketplace. This notice will be updated
            before sign-in or other features collect information, to explain the data
            used, its purpose, service providers, retention, and account deletion options.
          </p>
        </section>
        <section>
          <h2 className="mb-3 text-xl font-semibold text-[#F5F5F7]">External links</h2>
          <p>
            Links to GitHub and other websites take you to services with their own privacy
            practices. Re-Love does not receive information you submit on those services
            through this preview.
          </p>
        </section>
        <section>
          <h2 className="mb-3 text-xl font-semibold text-[#F5F5F7]">Privacy questions</h2>
          <p>
            Contact the Re-Love project through its GitHub issues page. Issues are public;
            do not include passwords, tokens, or personal information in your message.
          </p>
          <a href="https://github.com/Shuba-Matam/ReLove/issues" className="mt-3 inline-block text-[#8CB9FF] underline underline-offset-4">
            Ask a privacy question
          </a>
        </section>
      </div>
    </main>
  );
}
