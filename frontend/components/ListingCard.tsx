import Image from 'next/image'
import type { Listing } from '@/lib/supabase'

export function ListingCard({ listing }: { listing: Listing }) {
  return (
    <a
      href={listing.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex gap-3 rounded-2xl bg-surface border border-gray-100 p-3 shadow-sm hover:shadow-md hover:border-primary transition-all active:scale-[0.98]"
    >
      <div className="w-[72px] h-[72px] flex-shrink-0 rounded-xl bg-gray-100 overflow-hidden">
        {listing.image_url ? (
          <Image
            src={listing.image_url}
            alt={listing.title}
            width={72}
            height={72}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#d1d5db"
              strokeWidth="1.5"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </div>
        )}
      </div>

      <div className="flex flex-col justify-center min-w-0 flex-1">
        <p className="text-sm font-medium text-text leading-snug line-clamp-2">
          {listing.title}
        </p>
        {listing.price != null ? (
          <p className="text-sm font-semibold text-primary mt-1">
            {listing.price.toLocaleString('da-DK')} {listing.currency}
          </p>
        ) : (
          <p className="text-sm text-text-muted mt-1">Pris ikke angivet</p>
        )}
        {listing.location && (
          <p className="text-xs text-text-muted mt-0.5">{listing.location}</p>
        )}
      </div>
    </a>
  )
}
