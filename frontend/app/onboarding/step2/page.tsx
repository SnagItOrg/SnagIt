'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Brand {
  id: string
  label: string
  image?: string
  logoText?: string
  logoHeight?: string
  categories: string[]
}

const BRANDS: Brand[] = [
  {
    id: 'apple',
    label: 'Apple',
    image:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuC_1IZAxHXaSDxQsMrGLQe85obRmSSQQ6brN2jBXazn8h1mEZY_PvQfD_AnpQehGLGjLTkwrBi1JSRoAxgNcLrL2cEn1Y0lFTIVJzQTXgg7_dYgCXZ_mFvk_2zzVY5_b-3q70DGEAHjRDBivBEGtlT02zUBXVm0MKiJBMXxwUpQ99uy5QbdI9bjqSi6J8wtAEskv5_lgM84RXTb3p2CdPH49d6_xbU6UJD0z5i6GBBN8lu-ev-uWLJGRVn3DzS9FNiXcyYrP0sXvAQ',
    logoHeight: 'h-full',
    categories: ['tech'],
  },
  {
    id: 'sony',
    label: 'Sony',
    image:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuB5V3UWz_mnIY30k8hXdAEFsrzgEMIfRvahgm95swubCTA7khVG1aHL6TDBmczFMj4ePRvD2jtJ5hFf1EbYWAmbj8MYIRg9ukckQgaK5_HJJNpWIpHj0lV4lHydpiwdMdD4yboQkNEJ7QciUCs_FRZJ0PmKI1qIO7OaMQNlh6Dz-Xk7uiwgNr2O48hGIJ73-MI7o0qZ4n2bLGRtNfOtFcF3gLcwpZ7Mws6G6lURR9EtLUEZ8-zsO2CszGen4knRNzewsw4F1ejFzlg',
    logoHeight: 'h-auto w-full',
    categories: ['tech', 'music', 'photography'],
  },
  {
    id: 'teenage-engineering',
    label: 'Teenage Engineering',
    logoText: 'TEENAGE ENGINEERING',
    categories: ['music'],
  },
  {
    id: 'bang-olufsen',
    label: 'Bang & Olufsen',
    image:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuDmEXWp4KEVEhY4m1KBJAvBV5jOThy0iX3t2BFYwK6eSF-r2HctTewVO1MYY-TrutTQnYaxlh4umUVkhILQNpt0mRaxG5NZAMBWX3XaTsBu39cUtUDgB3fWsjbHMc2amT4qOXuQULzevCz_S8qdqwISwZhcOb-7vslC1zMz0XusqUM0od9qiQJrVy7Xkunh8xgMzgbpGwh9Yau97_hVBG5sMKxgEQCrBksL0NZ7xlSKne9Jbbo6l9eTCvV-wPAwjPUcnPESM-Ncmho',
    logoHeight: 'h-10',
    categories: ['music', 'tech'],
  },
  {
    id: 'canon',
    label: 'Canon',
    image:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuA32X96I-T_raqe_TtHv9iHVX74Vo9GijYqNJyxdLCW_FY9u6uhhu5oHDmfpuP-ICVc8LQivJbZu23VuVMjm7yX8nLBQcV1C1YA1kqTXWXTIGWJfOkyGYf5iLgMjTUcUu8wJzgqKFAYsasujZU98bP65lrDl17VzQ8_TQP5LOUUSSrc2_q0kpfJU3JY__jMAJUYgh4uTEooVlSWHY1C2tQqOt-Hi4wac_F9TKVY8C7-FB1crkadm6bc-J0ePM_iKhoaXm4oos7EcBk',
    logoHeight: 'h-10',
    categories: ['photography'],
  },
  {
    id: 'bose',
    label: 'Bose',
    image:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuCF9uq_jo08JqflNhrbohGq1ZaAS0dJ3D0_c3cWKGHQDLJB39EkGek4cmDdhMQ9sLHyIBEEsPhM5mBAQkK2Qft3Bak8i60SmQ4Vdw8f-uR9Qvvc2OBhMvXdd772bUKw3q4800wVxWgHpI9q8wIYlMP_SqGmaY7gA_JM5Xmb0ZT3mmq1WOdrFphHrjczqjAJoDk51ziwLcLt9DKNwOjO8BjFaLxHkqmPE252WbRU1Lr2EeYCdofvGPGbbvhD3IPBRKX8ZLQdqk5itjs',
    logoHeight: 'h-8',
    categories: ['music', 'tech'],
  },
  {
    id: 'nintendo',
    label: 'Nintendo',
    image:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuArXusq_BA0tRfh0lDAPzXh7xw9BuXNBj7BK2jZn2E5oJ-r20r9HKQKzJHV5V4K3sNX7WpoNN7TZ0sp7eS16k5fPezOpGG5SmpsYleSFG5jP9uoBRaSTOPT8zhFZF9Qw_Y-lj42GxgejQJUcVRGAA-EDR1ggwc2VfEDpH93tJQ64ivzoVbPCwdByCvCcR68NoEBimekw9qzY8Yr2a38CVwu_qwyT6WEClE6YjFSLH4aPMVKAXl_PTY-VYdhxEG32NCvBzYCScJFvW4',
    logoHeight: 'h-8',
    categories: ['tech'],
  },
]

// Selected by default in the mockup
const DEFAULT_STARRED = new Set(['apple', 'bang-olufsen'])

export default function Step2() {
  const router = useRouter()
  const [starred, setStarred] = useState<Set<string>>(new Set(DEFAULT_STARRED))
  const [search, setSearch] = useState('')

  function toggleStar(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setStarred((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleContinue() {
    localStorage.setItem('klup-onboarding-brands', JSON.stringify(Array.from(starred)))
    router.push('/onboarding/step3')
  }

  const filtered = search.trim()
    ? BRANDS.filter((b) => b.label.toLowerCase().includes(search.toLowerCase()))
    : BRANDS

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#102218', color: '#f1f5f9' }}>
      {/* Header */}
      <header
        className="border-b px-6 py-4 backdrop-blur-md sticky top-0 z-40"
        style={{ borderColor: '#326748', backgroundColor: 'rgba(16,34,24,0.8)' }}
      >
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3" style={{ color: '#13ec6d' }}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(19,236,109,0.1)' }}>
              <span className="material-symbols-outlined">radar</span>
            </div>
            <h2 className="text-xl font-black tracking-tight">Klup.dk</h2>
          </div>
          <div className="flex items-center gap-4">
            {/* Step dots */}
            <div className="flex gap-1.5">
              <div className="h-1.5 w-8 rounded-full" style={{ backgroundColor: 'rgba(19,236,109,0.3)' }} />
              <div
                className="h-1.5 w-12 rounded-full"
                style={{ backgroundColor: '#13ec6d', boxShadow: '0 0 8px rgba(19,236,109,0.5)' }}
              />
              <div className="h-1.5 w-8 rounded-full" style={{ backgroundColor: '#1e293b' }} />
            </div>
            <span className="text-xs font-bold uppercase tracking-widest" style={{ color: '#64748b' }}>
              Step 2 of 3
            </span>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 max-w-5xl mx-auto w-full p-6 lg:p-12">
        <div className="mb-12 text-center max-w-2xl mx-auto">
          <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4">Refine your hunt.</h1>
          <p className="text-lg" style={{ color: '#94a3b8' }}>
            We found these brands based on your{' '}
            <span className="font-semibold" style={{ color: '#13ec6d' }}>
              Tech &amp; Music
            </span>{' '}
            selection. Star your favorites to prioritize them in your feed.
          </p>
        </div>

        {/* Search + filter row */}
        <div className="flex flex-col md:flex-row gap-4 mb-8">
          <div className="relative flex-1">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2" style={{ color: '#64748b' }}>
              search
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search brands (e.g. Teenage Engineering...)"
              className="w-full rounded-2xl pl-12 pr-4 py-4 text-white outline-none transition-all"
              style={{
                backgroundColor: '#1a2e22',
                border: '1px solid #326748',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = '#13ec6d'; e.currentTarget.style.boxShadow = '0 0 0 2px rgba(19,236,109,0.15)' }}
              onBlur={(e) => { e.currentTarget.style.borderColor = '#326748'; e.currentTarget.style.boxShadow = 'none' }}
            />
          </div>
          <button
            className="flex items-center justify-center gap-2 px-6 py-4 rounded-2xl font-semibold transition-colors"
            style={{ border: '1px solid #326748', color: '#cbd5e1' }}
          >
            <span className="material-symbols-outlined">filter_list</span>
            All Categories
          </button>
        </div>

        {/* Brands grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-12">
          {filtered.map((brand) => {
            const isStarred = starred.has(brand.id)
            return (
              <div
                key={brand.id}
                className="group relative rounded-2xl p-8 flex flex-col items-center justify-center transition-all cursor-pointer"
                style={{
                  backgroundColor: '#1a2e22',
                  border: isStarred ? '2px solid #13ec6d' : '1px solid #326748',
                  boxShadow: isStarred ? '0 0 20px rgba(19,236,109,0.15)' : undefined,
                }}
                onClick={(e) => toggleStar(brand.id, e)}
              >
                {/* Star button */}
                <button
                  className="absolute top-4 right-4 transition-transform hover:scale-110"
                  style={{ color: isStarred ? '#13ec6d' : '#475569' }}
                  onClick={(e) => toggleStar(brand.id, e)}
                  aria-label={isStarred ? 'Unstar' : 'Star'}
                >
                  <span className={`material-symbols-outlined${isStarred ? ' filled' : ''}`}>star</span>
                </button>

                {/* Logo */}
                <div className="h-16 w-32 flex items-center justify-center mb-4">
                  {brand.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={brand.image}
                      alt={brand.label}
                      className={`${brand.logoHeight ?? 'h-full'} w-auto brightness-0 invert transition-opacity`}
                      style={{ opacity: isStarred ? 1 : 0.6 }}
                    />
                  ) : (
                    <div
                      className="font-mono text-xs tracking-tighter transition-opacity text-center"
                      style={{ color: '#ffffff', opacity: isStarred ? 1 : 0.6 }}
                    >
                      {brand.logoText}
                    </div>
                  )}
                </div>

                <p
                  className="font-bold text-center transition-colors"
                  style={{ color: isStarred ? '#13ec6d' : '#94a3b8' }}
                >
                  {brand.label}
                </p>
              </div>
            )
          })}

          {/* Add Another */}
          <div
            className="group rounded-2xl p-8 flex flex-col items-center justify-center transition-all cursor-pointer"
            style={{
              border: '2px dashed #326748',
              backgroundColor: 'rgba(26,46,34,0.2)',
            }}
          >
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center mb-3 transition-all"
              style={{ backgroundColor: '#1a2e22', color: '#64748b' }}
            >
              <span className="material-symbols-outlined">add</span>
            </div>
            <p className="font-bold" style={{ color: '#64748b' }}>
              Add Another
            </p>
          </div>
        </div>
      </main>

      {/* Sticky footer */}
      <footer
        className="sticky bottom-0 border-t p-6 backdrop-blur-xl"
        style={{ borderColor: '#326748', backgroundColor: 'rgba(16,34,24,0.9)' }}
      >
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <button
            onClick={() => router.push('/onboarding/step1')}
            className="flex items-center gap-2 font-bold transition-colors hover:text-white"
            style={{ color: '#64748b' }}
          >
            <span className="material-symbols-outlined">arrow_back</span>
            Back
          </button>
          <div className="flex items-center gap-6">
            <span className="hidden sm:inline text-sm font-medium italic" style={{ color: '#64748b' }}>
              {starred.size} {starred.size === 1 ? 'brand' : 'brands'} selected
            </span>
            <button
              onClick={handleContinue}
              className="px-10 py-4 rounded-2xl font-black text-lg transition-all flex items-center gap-2"
              style={{
                backgroundColor: '#13ec6d',
                color: '#102218',
                boxShadow: '0 10px 15px -3px rgba(19,236,109,0.2)',
              }}
            >
              Continue
              <span className="material-symbols-outlined">arrow_forward</span>
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}
