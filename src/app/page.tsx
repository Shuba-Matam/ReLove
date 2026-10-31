export default function Home() {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#020102] text-[#F5F5F7] antialiased">
      {/* Background — subtle depth using only mandated palette */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-[320px] left-1/2 h-[720px] w-[1040px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(3,36,94,0.22),transparent_66%)]" />
        <div className="absolute top-[84px] right-[-160px] hidden h-[520px] w-[520px] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(34,8,21,0.34),transparent_70%)] sm:block" />
        <div className="absolute top-[420px] left-[-180px] hidden h-[460px] w-[680px] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(2,22,64,0.28),transparent_72%)] lg:block" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#021640] to-transparent opacity-60" />
      </div>

      {/* Skip link */}
      <a
        href="#main"
        className="sr-only left-4 top-4 z-[60] rounded-full border border-[#021640] bg-[#01071d] px-4 py-2 text-sm font-medium text-[#F5F5F7] shadow focus:not-sr-only focus:absolute focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8FB8FF]/50"
      >
        Skip to content
      </a>

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-[#021640] bg-[#01071d]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-[64px] max-w-[1120px] items-center justify-between gap-4 px-4 sm:px-6">
          {/* Wordmark */}
          <a
            href="#"
            className="group flex items-center gap-3 rounded-xl p-1 -m-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8FB8FF]/50"
            aria-label="Re-Love — home"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-[11px] border border-[#021640] bg-[#020102] shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_8px_24px_rgba(0,0,0,0.45)]">
              <svg
                width="18"
                height="18"
                viewBox="0 0 20 20"
                fill="none"
                aria-hidden="true"
                className="text-[#8FB8FF]"
              >
                {/* two interlocking loops — reuse */}
                <path
                  d="M10 14.2c-1.9-1.4-3.9-2.8-3.9-5.1 0-1.35 1.05-2.45 2.35-2.45 0.85 0 1.6 0.45 2.05 1.12C10.95 7.1 11.7 6.65 12.55 6.65 13.85 6.65 14.9 7.75 14.9 9.1c0 2.3-2 3.7-3.9 5.1L10 15l-1-0.8Z"
                  stroke="currentColor"
                  strokeWidth="1.1"
                  strokeLinejoin="round"
                  fill="none"
                />
                <path
                  d="M5.2 10.2c-0.55-0.7-0.9-1.5-0.9-2.35a4.1 4.1 0 0 1 1.15-2.9M14.85 7c1 0.85 1.65 2.08 1.65 3.48 0 0.88-0.35 1.7-0.92 2.42M7.1 14.6c0.95 0.78 2.05 1.4 3.1 1.9M12.1 15.1c-1 0.2-2.05 0.08-2.95-0.32"
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeLinecap="round"
                  opacity="0.9"
                />
              </svg>
            </span>
            <span className="flex flex-col leading-none">
              <span className="text-[16.5px] font-[700] tracking-[-0.03em] text-[#F5F5F7]">
                Re<span className="font-[300] text-[#8FB8FF]">—</span>Love
              </span>
              <span className="text-[10.8px] font-[550] tracking-[0.08em] text-[#9AA4B8]">CAMPUS MARKETPLACE</span>
            </span>
          </a>

          <nav aria-label="Primary" className="hidden items-center gap-1.5 sm:flex">
            <a
              href="#how-it-works"
              className="rounded-full px-3.5 py-2 text-[13.5px] font-[550] tracking-[-0.01em] text-[#9AA4B8] transition hover:bg-[#021640]/60 hover:text-[#F5F5F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8FB8FF]/50"
            >
              How it works
            </a>
            <a
              href="#categories"
              className="rounded-full px-3.5 py-2 text-[13.5px] font-[550] tracking-[-0.01em] text-[#9AA4B8] transition hover:bg-[#021640]/60 hover:text-[#F5F5F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8FB8FF]/50"
            >
              Categories
            </a>
            <a
              href="#status"
              className="rounded-full px-3.5 py-2 text-[13.5px] font-[550] tracking-[-0.01em] text-[#9AA4B8] transition hover:bg-[#021640]/60 hover:text-[#F5F5F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8FB8FF]/50"
            >
              Status
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-2 rounded-full border border-[#021640] bg-[#020102] px-3 py-1.5 text-xs font-semibold tracking-wide text-[#9AA4B8] sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-[#8FB8FF] shadow-[0_0_8px_rgba(143,184,255,0.7)]" aria-hidden />
              Marketplace coming soon
            </span>
            {/* Mobile anchor access */}
            <a
              href="#how-it-works"
              className="inline-flex items-center rounded-full bg-[#03245e] px-4 py-2 text-[13px] font-semibold tracking-[-0.01em] text-[#F5F5F7] shadow-[0_1px_0_rgba(255,255,255,0.06)_inset] transition hover:bg-[#0a3a8a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8FB8FF]/50 sm:hidden"
            >
              Explore
            </a>
          </div>
        </div>
      </header>

      <main id="main" className="relative">
        {/* HERO */}
        <section className="mx-auto max-w-[1120px] px-4 pb-8 pt-8 sm:px-6 sm:pt-12 lg:pt-14">
          <div className="grid gap-8 lg:grid-cols-[1.06fr_0.94fr] lg:gap-10 lg:items-start">
            {/* Left */}
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2.5 rounded-full border border-[#021640] bg-[#01071d] px-3 py-1.5 pr-3.5 shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
                <span className="inline-flex items-center gap-2 rounded-full bg-[#020102] px-2.5 py-1 text-[11px] font-bold tracking-[0.08em] text-[#F5F5F7] ring-1 ring-[#021640]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#8FB8FF]" aria-hidden />
                  EARLY PREVIEW
                </span>
                <span className="hidden text-xs font-medium tracking-[-0.01em] text-[#9AA4B8] sm:inline">Student marketplace in progress</span>
                <span className="text-xs font-medium text-[#9AA4B8] sm:hidden">In progress</span>
              </div>

              <h1 className="mt-6 text-balance text-[32px] font-[780] leading-[0.96] tracking-[-0.035em] text-[#F5F5F7] sm:text-[44px] lg:text-[52px]">
                Give student <span className="font-[300] italic tracking-[-0.04em] text-[#8FB8FF]">essentials</span> a second home.
              </h1>

              <p className="mt-5 max-w-[58ch] text-pretty text-[15.5px] leading-7 text-[#9AA4B8] sm:text-[16.5px] sm:leading-8">
                Re-Love is a campus marketplace being built for the stuff that piles up between moves — textbooks, kettles, lamps, lab coats, winter layers.{" "}
                <span className="font-[600] text-[#F5F5F7]">Pass on what you’re done with. Find what you actually need next term.</span> No clutter, no waste, just things staying useful a little longer.
              </p>

              <div className="mt-7 flex flex-wrap gap-3">
                <a
                  href="#how-it-works"
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-[#03245e] px-6 py-[13px] text-[14.5px] font-[650] tracking-[-0.01em] text-[#F5F5F7] shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_8px_22px_rgba(3,36,94,0.35)] transition hover:bg-[#0a3a8a] hover:translate-y-[-1px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8FB8FF]/60 active:translate-y-0"
                >
                  How it works
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </a>
                <a
                  href="#categories"
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-[#021640] bg-[#01071d] px-6 py-[13px] text-[14.5px] font-[600] tracking-[-0.01em] text-[#F5F5F7] shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] transition hover:border-[#0a3a8a]/60 hover:bg-[#021640]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8FB8FF]/50"
                >
                  See example categories
                </a>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[#021640]/70 pt-5 text-[13px] leading-5 text-[#9AA4B8]">
                <span className="inline-flex items-center gap-2">
                  <span className="h-1 w-1 rounded-full bg-[#9AA4B8]/70" aria-hidden />
                  Planned for campus buying &amp; selling
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-1 w-1 rounded-full bg-[#9AA4B8]/70" aria-hidden />
                  Illustrative preview — no live listings yet
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-1 w-1 rounded-full bg-[#9AA4B8]/70" aria-hidden />
                  No account needed to look around
                </span>
              </div>
            </div>

            {/* Right — preview card, not fake inventory */}
            <div className="relative min-w-0 lg:pt-2">
              <div className="relative overflow-hidden rounded-[20px] border border-[#021640] bg-[#01071d] shadow-[0_20px_48px_rgba(0,0,0,0.55),0_1px_0_rgba(255,255,255,0.04)_inset]">
                {/* card header */}
                <div className="flex items-center justify-between border-b border-[#021640] bg-[#020102]/40 px-4 py-3 sm:px-5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#03245e] text-[#F5F5F7]">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path
                          d="M2.5 5.5A1.5 1.5 0 0 1 4 4h5.2a1.5 1.5 0 0 1 1.5 1.5v6.1a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 11.6V5.5Z M9.7 4l3.8 3.1v5.5"
                          stroke="currentColor"
                          strokeWidth="1.2"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                    <div className="leading-tight">
                      <p className="text-[13px] font-[650] tracking-[-0.015em] text-[#F5F5F7]">Marketplace preview</p>
                      <p className="text-xs font-medium tracking-[-0.01em] text-[#9AA4B8]">What Re-Love will hold</p>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#021640] bg-[#220815]/60 px-2.5 py-1 text-[11px] font-bold tracking-[0.06em] text-[#F5F5F7]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#F5F5F7] opacity-80" aria-hidden />
                    COMING SOON
                  </span>
                </div>

                {/* empty-state illustration */}
                <div className="p-4 sm:p-5">
                  <div className="rounded-[14px] border border-dashed border-[#021640] bg-[#020102] p-3.5 sm:p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold tracking-[0.07em] text-[#9AA4B8]">EXAMPLE SHELVES — NOT LIVE LISTINGS</p>
                      <span className="hidden text-xs text-[#9AA4B8]/60 sm:inline">4 categories</span>
                    </div>

                    <div className="mt-3.5 grid grid-cols-2 gap-2.5">
                      <div className="rounded-xl border border-[#021640] bg-[#01071d] p-3">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#03245e]/30 ring-1 ring-[#021640] text-[#8FB8FF]">
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                            <path d="M3 3.5h8a1 1 0 0 1 1 1v8.5H4.2A1.7 1.7 0 0 0 2.5 14.7V4.2a1 1 0 0 1 .5-.7Z M6.5 3.5v9.5 M11 7h1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                          </svg>
                        </div>
                        <p className="mt-3 text-[12.5px] font-[650] leading-none tracking-[-0.01em] text-[#F5F5F7]">Textbooks &amp; notes</p>
                        <p className="mt-1.5 text-xs leading-[1.4] text-[#9AA4B8]">Course kits &amp; guides ready for the next reader.</p>
                      </div>
                      <div className="rounded-xl border border-[#021640] bg-[#01071d] p-3">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#220815] ring-1 ring-[#021640] text-[#F5F5F7]">
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                            <path d="M8 3l-5 2.7v5L8 13.5l5-2.8v-5L8 3Z M3 5.7l5 2.8 5-2.8 M8 8.5v5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </div>
                        <p className="mt-3 text-[12.5px] font-[650] leading-none tracking-[-0.01em] text-[#F5F5F7]">Room &amp; living</p>
                        <p className="mt-1.5 text-xs leading-[1.4] text-[#9AA4B8]">Lamps, bedding, kitchen basics.</p>
                      </div>
                      <div className="rounded-xl border border-[#021640] bg-[#01071d] p-3">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#03245e]/30 ring-1 ring-[#021640] text-[#8FB8FF]">
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                            <path d="M2.5 6.5h11v5.2a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V6.5Z M6 3.5h4l1 3H5l1-3Z M5 9.5h1.2 M9.8 9.5H11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </div>
                        <p className="mt-3 text-[12.5px] font-[650] leading-none tracking-[-0.01em] text-[#F5F5F7]">Tech &amp; study</p>
                        <p className="mt-1.5 text-xs leading-[1.4] text-[#9AA4B8]">Monitors, keyboards, calculators.</p>
                      </div>
                      <div className="rounded-xl border border-[#021640] bg-[#01071d] p-3">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#220815] ring-1 ring-[#021640] text-[#F5F5F7]">
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                            <path d="M8 3c-1.8 0-3.4 1.2-3.9 3M8 3c1.8 0 3.4 1.2 3.9 3M4.1 6l-1.3-.6M11.9 6l1.3-.6 M3.2 10.5l-1 1.3 1.9.6 1-1.3-1.9-.6ZM11.8 10.5l1 1.3-1.9.6-1-1.3 1.9-.6Z" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </div>
                        <p className="mt-3 text-[12.5px] font-[650] leading-none tracking-[-0.01em] text-[#F5F5F7]">Move-out &amp; seasonal</p>
                        <p className="mt-1.5 text-xs leading-[1.4] text-[#9AA4B8]">Fans, storage, winter essentials.</p>
                      </div>
                    </div>

                    <p className="mt-3 text-center text-[11px] font-medium leading-4 text-[#9AA4B8]/80">
                      Placeholders to show scope — no prices, no inventory, no sellers yet.
                    </p>
                  </div>

                  <div className="mt-3.5 flex items-center justify-between rounded-full bg-[#03245e]/18 px-3 py-2.5 ring-1 ring-[#021640]">
                    <span className="text-xs font-medium tracking-[-0.01em] text-[#9AA4B8]">Made for passing useful things on.</span>
                    <a href="#how-it-works" className="text-xs font-semibold tracking-[-0.01em] text-[#8FB8FF] underline decoration-[#8FB8FF]/30 underline-offset-4 hover:decoration-[#8FB8FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8FB8FF]/50 rounded-full px-1">
                      Learn more →
                    </a>
                  </div>
                </div>
              </div>

              {/* floating note — hides on very small to keep 360px clean */}
              <div className="relative -mt-3 ml-auto mr-2 w-[min(340px,calc(100%-16px))] overflow-hidden rounded-[14px] border border-[#021640] bg-[#220815] p-3 shadow-[0_10px_28px_rgba(0,0,0,0.5)] sm:mr-4 sm:p-3.5">
                <div className="flex gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#01071d] text-[#F5F5F7] ring-1 ring-white/10">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                      <path d="M6 2.5v3.2l2.1 1.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                      <circle cx="6" cy="6" r="4.2" stroke="currentColor" strokeWidth="1.1" />
                    </svg>
                  </span>
                  <div>
                    <p className="text-xs font-bold tracking-[0.05em] text-[#F5F5F7]">GOOD THINGS DESERVE ANOTHER CHAPTER</p>
                    <p className="mt-1 text-[13px] leading-[1.5] text-[#F5F5F7]/90">
                      A textbook for the next semester. A lamp for a new room. Re-Love is being built to help useful things find their next owner.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section
          id="how-it-works"
          className="mx-auto max-w-[1120px] scroll-mt-[72px] px-4 pb-4 pt-8 sm:px-6 sm:pt-10"
          aria-labelledby="how-heading"
        >
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold tracking-[0.12em] text-[#8FB8FF]">HOW IT WILL WORK</p>
              <h2
                id="how-heading"
                className="mt-2 max-w-[14ch] text-[24px] font-[730] leading-[1.05] tracking-[-0.03em] text-[#F5F5F7] sm:text-[30px]"
              >
                Simple, local, and meant to circle back.
              </h2>
            </div>
            <p className="max-w-[36ch] text-sm leading-6 text-[#9AA4B8]">The planned marketplace brings listings, search, and seller conversations together.</p>
          </div>

          <div className="mt-6 grid gap-4 sm:gap-5 md:grid-cols-3">
            {/* Step 1 */}
            <div className="group relative overflow-hidden rounded-[16px] border border-[#021640] bg-[#01071d] p-5 shadow-[0_10px_24px_rgba(0,0,0,0.35)] transition hover:border-[#03245e]/50 hover:bg-[#021640]/20">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#03245e]/60 to-transparent opacity-70" aria-hidden />
              <div className="flex items-center gap-3">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#03245e] text-[12.5px] font-[800] tracking-[0.04em] text-[#F5F5F7] ring-1 ring-white/10">01</span>
                <span className="text-xs font-semibold tracking-[0.08em] text-[#9AA4B8]">LIST GENTLY</span>
              </div>
              <h3 className="mt-4 text-[15.5px] font-[650] tracking-[-0.015em] text-[#F5F5F7]">Pass on what you’re done with</h3>
              <p className="mt-2 text-sm leading-6 text-[#9AA4B8]">Describe the condition honestly — a few clear photos, where you are on campus, and any quirks. No storefront, just one kind hand-off at a time.</p>
            </div>

            {/* Step 2 */}
            <div className="group relative overflow-hidden rounded-[16px] border border-[#021640] bg-[#01071d] p-5 shadow-[0_10px_24px_rgba(0,0,0,0.35)] transition hover:border-[#03245e]/50 hover:bg-[#021640]/20">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#03245e]/60 to-transparent opacity-70" aria-hidden />
              <div className="flex items-center gap-3">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#01071d] text-[12.5px] font-[800] tracking-[0.04em] text-[#F5F5F7] ring-1 ring-[#021640]">02</span>
                <span className="text-xs font-semibold tracking-[0.08em] text-[#9AA4B8]">FIND NEARBY</span>
              </div>
              <h3 className="mt-4 text-[15.5px] font-[650] tracking-[-0.015em] text-[#F5F5F7]">Search by need, not endless scrolling</h3>
              <p className="mt-2 text-sm leading-6 text-[#9AA4B8]">Browse by category, price, condition, and hostel block to find what fits your needs.</p>
            </div>

            {/* Step 3 */}
            <div className="group relative overflow-hidden rounded-[16px] border border-[#021640] bg-[#01071d] p-5 shadow-[0_10px_24px_rgba(0,0,0,0.35)] transition hover:border-[#220815]/50 hover:bg-[#220815]/15">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#220815] to-transparent opacity-60" aria-hidden />
              <div className="flex items-center gap-3">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#220815] text-[12.5px] font-[800] tracking-[0.04em] text-[#F5F5F7] ring-1 ring-[#021640]">03</span>
                <span className="text-xs font-semibold tracking-[0.08em] text-[#9AA4B8]">MEET &amp; EXCHANGE</span>
              </div>
              <h3 className="mt-4 text-[15.5px] font-[650] tracking-[-0.015em] text-[#F5F5F7]">Coordinate a safe campus hand-off</h3>
              <p className="mt-2 text-sm leading-6 text-[#9AA4B8]">Message the seller, agree on a public meeting spot, and arrange the exchange together.</p>
            </div>
          </div>

          <p className="mt-3 text-center text-xs font-medium tracking-[-0.01em] text-[#9AA4B8]/70">Planned flow — listings and messaging are still in development.</p>
        </section>

        {/* CATEGORIES */}
        <section id="categories" className="mx-auto max-w-[1120px] scroll-mt-[72px] px-4 pb-2 pt-8 sm:px-6 sm:pt-10" aria-labelledby="cat-heading">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold tracking-[0.12em] text-[#8FB8FF]">EXAMPLE CATEGORIES</p>
              <h2 id="cat-heading" className="mt-2 max-w-[16ch] text-[24px] font-[730] leading-[1.05] tracking-[-0.03em] text-[#F5F5F7] sm:text-[30px]">
                What people usually pass on each term.
              </h2>
            </div>
            <div className="rounded-full border border-[#021640] bg-[#01071d] px-3.5 py-2 text-xs font-medium leading-none text-[#9AA4B8]">
              Illustrative only <span className="opacity-60">·</span> <span className="text-[#F5F5F7]">no live inventory</span>
            </div>
          </div>

          <div className="mt-6 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <article className="rounded-[16px] border border-[#021640] bg-[#01071d] p-4 sm:p-[18px]">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[#021640] bg-[#020102] text-[#8FB8FF]">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M4 3h6c.7 0 1.2.6 1.2 1.2v7.3c0 .7-.6 1.2-1.2 1.2H4V3Z M4 13V3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                  <path d="M6.2 6.2h3.2 M6.2 8.2h3.2 M6.2 10.2h2.3" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
                </svg>
              </div>
              <h3 className="mt-3 text-sm font-[650] tracking-[-0.01em] text-[#F5F5F7]">Textbooks &amp; course kits</h3>
              <p className="mt-1.5 text-[13px] leading-5 text-[#9AA4B8]">Past-year texts, lab coats, calculators, and printed notes you no longer need.</p>
              <p className="mt-2 text-[11px] font-semibold tracking-[0.06em] text-[#9AA4B8]/70">EXAMPLES</p>
              <p className="text-xs leading-5 text-[#9AA4B8]">Intro to Psychology, dissection kit, TI-84</p>
            </article>

            <article className="rounded-[16px] border border-[#021640] bg-[#01071d] p-4 sm:p-[18px]">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[#021640] bg-[#020102] text-[#8FB8FF]">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M3 6.5 8 3.7 13 6.5v5.3L8 14.6 3 11.8V6.5Z M8 3.7v8.1 M3 6.5 8 9.3 13 6.5" stroke="currentColor" strokeWidth="1.15" strokeLinejoin="round" />
                </svg>
              </div>
              <h3 className="mt-3 text-sm font-[650] tracking-[-0.01em] text-[#F5F5F7]">Room &amp; living</h3>
              <p className="mt-1.5 text-[13px] leading-5 text-[#9AA4B8]">Lamps, bedding, small storage, kitchen basics that make a new room feel like home.</p>
              <p className="mt-2 text-[11px] font-semibold tracking-[0.06em] text-[#9AA4B8]/70">EXAMPLES</p>
              <p className="text-xs leading-5 text-[#9AA4B8]">Desk lamp, drying rack, kettle</p>
            </article>

            <article className="rounded-[16px] border border-[#021640] bg-[#01071d] p-4 sm:p-[18px]">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[#021640] bg-[#020102] text-[#8FB8FF]">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <rect x="2.5" y="4.8" width="11" height="7.2" rx="1.2" stroke="currentColor" strokeWidth="1.15" />
                  <path d="M5 4.8V3.5c0-.6.5-1 1-1h4c.6 0 1 .4 1 1v1.3 M5.8 8.4H7 M9 8.4h1.2" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
                </svg>
              </div>
              <h3 className="mt-3 text-sm font-[650] tracking-[-0.01em] text-[#F5F5F7]">Tech &amp; study</h3>
              <p className="mt-1.5 text-[13px] leading-5 text-[#9AA4B8]">Monitors, keyboards, headphones, and chargers, with condition described by the seller.</p>
              <p className="mt-2 text-[11px] font-semibold tracking-[0.06em] text-[#9AA4B8]/70">EXAMPLES</p>
              <p className="text-xs leading-5 text-[#9AA4B8]">24″ monitor, mechanical keyboard</p>
            </article>

            <article className="rounded-[16px] border border-[#021640] bg-[#01071d] p-4 sm:p-[18px]">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[#021640] bg-[#220815]/60 text-[#F5F5F7]">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <circle cx="8" cy="7" r="3.4" stroke="currentColor" strokeWidth="1.15" />
                  <path d="M5.2 13.2c.4-1 1.5-1.7 2.8-1.7s2.4.7 2.8 1.7" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
                </svg>
              </div>
              <h3 className="mt-3 text-sm font-[650] tracking-[-0.01em] text-[#F5F5F7]">Move-out &amp; seasonal</h3>
              <p className="mt-1.5 text-[13px] leading-5 text-[#9AA4B8]">Fans, heaters, heavy coats, suitcases — the bulky things hardest to move and easiest to re-home.</p>
              <p className="mt-2 text-[11px] font-semibold tracking-[0.06em] text-[#9AA4B8]/70">EXAMPLES</p>
              <p className="text-xs leading-5 text-[#9AA4B8]">Coat size M, small heater, storage bins</p>
            </article>
          </div>

          <div className="mt-4 rounded-[14px] border border-[#021640] bg-[#01071d]/60 px-4 py-3 text-center text-xs leading-5 text-[#9AA4B8]">
            These are <span className="font-semibold text-[#F5F5F7]">examples of what Re-Love will support</span> — not items currently for sale. We don’t show prices, sellers, or availability until the marketplace opens.
          </div>
        </section>

        {/* STATUS — marketplace coming soon */}
        <section id="status" className="mx-auto max-w-[1120px] scroll-mt-[72px] px-4 pb-8 pt-8 sm:px-6 sm:pb-12 sm:pt-10" aria-labelledby="status-heading">
          <div className="overflow-hidden rounded-[20px] border border-[#021640] bg-[#01071d] shadow-[0_16px_40px_rgba(0,0,0,0.5)]">
            <div className="grid lg:grid-cols-[1.08fr_0.92fr]">
              <div className="p-5 sm:p-7">
                <div className="inline-flex items-center gap-2 rounded-full bg-[#020102] px-3 py-1 ring-1 ring-[#021640]">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#8FB8FF]" aria-hidden />
                  <span className="text-[11px] font-bold tracking-[0.08em] text-[#8FB8FF]">STATUS</span>
                  <span className="text-xs font-semibold tracking-[-0.01em] text-[#F5F5F7]">Marketplace coming soon</span>
                </div>

                <h2 id="status-heading" className="mt-4 text-[22px] font-[740] leading-[1.08] tracking-[-0.03em] text-[#F5F5F7] sm:text-[26px]">
                  We’re not trading yet. Here’s what happens next.
                </h2>
                <p className="mt-3 max-w-[54ch] text-sm leading-6 text-[#9AA4B8]">
                  Re-Love is in development. This preview introduces the idea; creating listings, browsing items, and messaging sellers will come next.
                </p>

                <ul className="mt-5 space-y-2.5">
                  <li className="flex gap-3 text-sm leading-5 text-[#9AA4B8]">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#03245e]" aria-hidden />
                    <span>
                      <span className="font-semibold text-[#F5F5F7]">Built for students</span> — everyday essentials for student life.
                    </span>
                  </li>
                  <li className="flex gap-3 text-sm leading-5 text-[#9AA4B8]">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#03245e]" aria-hidden />
                    <span>
                      <span className="font-semibold text-[#F5F5F7]">Straightforward listing</span> — clear photos, prices, condition, and hostel block.
                    </span>
                  </li>
                  <li className="flex gap-3 text-sm leading-5 text-[#9AA4B8]">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#220815]" aria-hidden />
                    <span>
                      <span className="font-semibold text-[#F5F5F7]">In-person exchange</span> — arrange a public meeting spot together.
                    </span>
                  </li>
                </ul>

                <div className="mt-6 flex flex-wrap gap-3">
                  <a
                    href="#how-it-works"
                    className="inline-flex items-center justify-center rounded-full bg-[#F5F5F7] px-5 py-2.5 text-[13.5px] font-[650] tracking-[-0.015em] text-[#01071d] transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8FB8FF]/60"
                  >
                    How it will work
                  </a>
                  <a
                    href="#categories"
                    className="inline-flex items-center justify-center rounded-full border border-[#021640] bg-[#020102] px-5 py-2.5 text-[13.5px] font-[600] tracking-[-0.01em] text-[#F5F5F7] transition hover:bg-[#021640]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8FB8FF]/50"
                  >
                    What you can pass on
                  </a>
                </div>
              </div>

              <div className="border-t border-[#021640] bg-[#020102] p-5 sm:p-7 lg:border-l lg:border-t-0">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold tracking-[0.08em] text-[#9AA4B8]">WHAT TO EXPECT</h3>
                  <span className="rounded-full border border-[#021640] bg-[#01071d] px-2.5 py-1 text-[11px] font-semibold text-[#9AA4B8]">Preview build</span>
                </div>

                <div className="mt-4 space-y-3">
                  <div className="flex gap-3 rounded-[12px] border border-[#021640] bg-[#01071d] p-3.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#03245e] text-[#F5F5F7]">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path d="M8 3.2a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 0 0 0-9.6ZM8 5.5v3.2l2.2 1.3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <div>
                      <p className="text-[13px] font-[650] tracking-[-0.01em] text-[#F5F5F7]">Now — public preview</p>
                      <p className="mt-1 text-xs leading-5 text-[#9AA4B8]">Get to know Re-Love and how the marketplace will work.</p>
                    </div>
                  </div>

                  <div className="flex gap-3 rounded-[12px] border border-[#021640] bg-[#01071d] p-3.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#01071d] text-[#9AA4B8] ring-1 ring-[#021640]">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path d="M3.5 8H12.5M8 3.5l4.5 4.5L8 12.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <div>
                      <p className="text-[13px] font-[650] tracking-[-0.01em] text-[#F5F5F7]">Next — marketplace basics</p>
                      <p className="mt-1 text-xs leading-5 text-[#9AA4B8]">Create listings, find useful items, and message sellers.</p>
                    </div>
                  </div>

                  <div className="flex gap-3 rounded-[12px] border border-dashed border-[#021640] bg-transparent p-3.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#220815]/40 text-[#F5F5F7] ring-1 ring-[#021640]">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path d="M8 3.5c2 0 3.7 1.2 4.5 2.9M8 3.5C6 3.5 4.3 4.7 3.5 6.4M4.2 9.2 3 12l3-1.1" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <div>
                      <p className="text-[13px] font-[650] tracking-[-0.01em] text-[#F5F5F7]">Then — thoughtful refinements</p>
                      <p className="mt-1 text-xs leading-5 text-[#9AA4B8]">Refine the experience through testing and feedback.</p>
                    </div>
                  </div>
                </div>

                <p className="mt-4 rounded-full bg-[#03245e]/14 px-3 py-2 text-center text-[11.5px] font-medium leading-4 text-[#9AA4B8] ring-1 ring-[#021640]">
                  The marketplace is still being built.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="relative mt-6 border-t border-[#021640] bg-[#01071d]/90">
        <div className="mx-auto max-w-[1120px] px-4 py-8 sm:px-6 sm:py-10">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[#021640] bg-[#020102] text-[#8FB8FF]">
                  <svg width="12" height="12" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path
                      d="M10 13.5c-1.6-1.15-3.2-2.35-3.2-4.2 0-1.1.85-2 1.95-2 .7 0 1.33.37 1.7.93.37-.56 1-.93 1.7-.93 1.1 0 1.95.9 1.95 2 0 1.85-1.6 3.05-3.2 4.2L10 14.2l-.9-.7Z"
                      stroke="currentColor"
                      strokeWidth="1"
                    />
                  </svg>
                </span>
                <span className="text-sm font-[700] tracking-[-0.02em] text-[#F5F5F7]">
                  Re<span className="font-[300] text-[#8FB8FF]">—</span>Love
                </span>
                <span className="hidden text-xs tracking-[0.08em] text-[#9AA4B8] sm:inline">·</span>
                <span className="hidden text-xs font-medium tracking-[-0.01em] text-[#9AA4B8] sm:inline">Pass it on, campus to campus.</span>
              </div>
              <p className="mt-3 max-w-[52ch] text-sm leading-6 text-[#9AA4B8]">
                A coming-soon marketplace for student essentials to get a second home. Give useful things another chapter.
              </p>
            </div>

            <div className="flex gap-8 sm:gap-12">
              <div>
                <p className="text-[11px] font-bold tracking-[0.1em] text-[#9AA4B8]">LINKS</p>
                <ul className="mt-3 space-y-2.5 text-sm">
                  <li>
                    <a
                      href="/privacy"
                      className="font-medium tracking-[-0.01em] text-[#F5F5F7] decoration-[#8FB8FF]/40 underline-offset-4 hover:text-[#8FB8FF] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8FB8FF]/50 rounded px-1 -mx-1"
                    >
                      Privacy
                    </a>
                  </li>
                  <li>
                    <a
                      href="https://github.com/Shuba-Matam/ReLove"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 font-medium tracking-[-0.01em] text-[#F5F5F7] decoration-[#8FB8FF]/40 underline-offset-4 hover:text-[#8FB8FF] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8FB8FF]/50 rounded px-1 -mx-1"
                    >
                      Source code
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="opacity-60">
                        <path d="M5.5 4.5H11v5.5M9.2 6.8 4.5 11.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </a>
                  </li>
                </ul>
              </div>

              <div>
                <p className="text-[11px] font-bold tracking-[0.1em] text-[#9AA4B8]">ON THIS PAGE</p>
                <ul className="mt-3 space-y-2.5 text-sm">
                  <li>
                    <a href="#how-it-works" className="font-medium tracking-[-0.01em] text-[#9AA4B8] hover:text-[#F5F5F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8FB8FF]/50 rounded px-1 -mx-1">
                      How it works
                    </a>
                  </li>
                  <li>
                    <a href="#categories" className="font-medium tracking-[-0.01em] text-[#9AA4B8] hover:text-[#F5F5F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8FB8FF]/50 rounded px-1 -mx-1">
                      Example categories
                    </a>
                  </li>
                  <li>
                    <a href="#status" className="font-medium tracking-[-0.01em] text-[#9AA4B8] hover:text-[#F5F5F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8FB8FF]/50 rounded px-1 -mx-1">
                      Coming soon status
                    </a>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div className="mt-8 flex flex-col gap-3 border-t border-[#021640] pt-6 text-xs leading-5 text-[#9AA4B8] sm:flex-row sm:items-center sm:justify-between">
            <p>© 2026 Re-Love · Student marketplace preview · No live trading yet.</p>
            <p className="text-[#9AA4B8]/80">Learn about this preview in our Privacy notice.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
