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
        Add Re-Love to your home screen for faster access. It opens like an
        app and stays in your recent apps, but it still needs the internet to
        work.
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
              Tap the Share button (square with an arrow pointing up) in the
              toolbar.
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
            If you do not see an install option, use Add to Home Screen from
            the same menu, or open the site from your home screen bookmark.
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
              If there is no address bar icon, open the browser Apps menu
              (or the three-dot menu → Save and share / Apps → Install) and
              choose Install.
            </li>
            <li>Re-Love will open in its own window and stay in your apps.</li>
          </ol>
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
              Re-Love does not currently send push notifications when the app
              is closed. Check your inbox when you open Re-Love for new
              messages.
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
            Remove Re-Love like any other home screen app or shortcut — long
            press the icon and remove it. You can reinstall any time from this
            page.
          </p>
        </section>
      </div>
    </article>
  );
}
