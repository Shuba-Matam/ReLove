import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Install Re-Love",
  description:
    "How to add Re-Love to your home screen on iPhone, iPad, Android, and desktop.",
  alternates: { canonical: "/install" },
};

export default function InstallPage() {
  return (
    <article className="mx-auto max-w-3xl py-6 sm:py-10">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-[#82b7ff] underline decoration-[#03245e]/50 underline-offset-4 hover:text-[#93c5fd]"
      >
        ← Back to Re-Love
      </Link>

      <h1 className="mt-6 text-2xl font-semibold tracking-tight text-[#F5F5F7] md:text-3xl">
        Install Re-Love
      </h1>
      <p className="mt-3 max-w-[60ch] text-sm leading-6 text-[#9AA4B8]">
        Add Re-Love to your home screen for faster access. You can also keep
        using Re-Love in your browser without installing it.
      </p>

      <div className="mt-8 space-y-8 pt-8 text-sm leading-7 text-[#9AA4B8]">
        <section
          aria-labelledby="offline-heading"
          className="rounded-xl border border-[#021640]/60 bg-[#01071d] p-5 md:p-6"
        >
          <h2
            id="offline-heading"
            className="text-base font-medium text-[#F5F5F7]"
          >
            What works without internet
          </h2>
          <p className="mt-2">
            Internet is needed for listings, messages, and publishing.
            Installation does not make those available offline. When offline,
            Re-Love shows only the saved offline notice and icons — private
            pages, listings, and messages are not cached for offline use.
          </p>
        </section>

        <section aria-labelledby="iphone-heading">
          <h2
            id="iphone-heading"
            className="text-lg font-medium text-[#F5F5F7]"
          >
            iPhone and iPad — Safari
          </h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 marker:text-[#82b7ff]">
            <li>Open Re-Love in Safari.</li>
            <li>
              Tap Share (the square with an arrow pointing up). Depending on
              your Safari layout, you may need to open the Page Menu first.
            </li>
            <li>
              Choose <span className="text-[#F5F5F7]">Add to Home Screen</span>.
            </li>
            <li>
              If offered, choose{" "}
              <span className="text-[#F5F5F7]">Open as Web App</span>, then tap{" "}
              <span className="text-[#F5F5F7]">Add</span>.
            </li>
            <li>Open Re-Love from the new home screen icon.</li>
          </ol>
        </section>

        <section aria-labelledby="android-heading">
          <h2
            id="android-heading"
            className="text-lg font-medium text-[#F5F5F7]"
          >
            Android — Chrome
          </h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 marker:text-[#82b7ff]">
            <li>Open Re-Love in Chrome.</li>
            <li>Open the Chrome menu (three dots, top right).</li>
            <li>
              Tap <span className="text-[#F5F5F7]">Install app</span> or{" "}
              <span className="text-[#F5F5F7]">Add to Home Screen</span> if
              offered.
            </li>
            <li>Confirm to add it, then open from your home screen.</li>
          </ol>
          <p className="mt-3">
            If neither option is available, bookmark Re-Love and keep using
            it in Chrome.
          </p>
        </section>

        <section aria-labelledby="desktop-heading">
          <h2
            id="desktop-heading"
            className="text-lg font-medium text-[#F5F5F7]"
          >
            Desktop — Chrome and Edge
          </h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 marker:text-[#82b7ff]">
            <li>Open Re-Love in Chrome or Edge on your computer.</li>
            <li>
              Look for the install icon in the address bar. If offered, click
              it to install.
            </li>
            <li>
              If there is no address bar icon, check the browser menu under
              Apps or Save and share for an install option.
            </li>
            <li>If installation is offered, confirm it to open Re-Love in its own window.</li>
          </ol>
          <p className="mt-3">
            If no install option is available, keep using Re-Love in a browser tab.
          </p>
        </section>

        <section
          aria-labelledby="after-heading"
          className="rounded-xl border border-[#021640]/60 bg-[#01071d] p-5 md:p-6"
        >
          <h2
            id="after-heading"
            className="text-base font-medium text-[#F5F5F7]"
          >
            After installing
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 marker:text-[#82b7ff]">
            <li>
              Browse and publish from the installed app as normal:{" "}
              <Link
                href="/"
                className="text-[#82b7ff] underline decoration-[#03245e]/60 underline-offset-4 hover:text-[#93c5fd] hover:decoration-[#93c5fd]"
              >
                go to Re-Love
              </Link>
              .
            </li>
            <li>
              Installation alone does not enable notifications. To check what
              alerts are available for your account and how to manage them,
              visit{" "}
              <Link
                href="/profile"
                className="text-[#82b7ff] underline decoration-[#03245e]/60 underline-offset-4 hover:text-[#93c5fd] hover:decoration-[#93c5fd]"
              >
                your profile
              </Link>
              .
            </li>
            <li>
              Check your inbox when you open Re-Love for new messages. Any
              optional alerts need to be enabled separately from your profile.
            </li>
          </ul>
        </section>

        <section aria-labelledby="remove-heading">
          <h2
            id="remove-heading"
            className="text-lg font-medium text-[#F5F5F7]"
          >
            Remove or reinstall
          </h2>
          <p className="mt-2">
            On a phone or tablet, press and hold the home screen icon to see
            removal options. On a computer, use the installed app&apos;s menu
            or your browser&apos;s app settings. You can return to this guide
            to install it again.
          </p>
        </section>
      </div>
    </article>
  );
}
