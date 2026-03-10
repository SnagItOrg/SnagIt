'use client'

const STEP = 100

interface Props {
  minPrice: number
  maxPrice: number
  maxValue?: number
  step?: number
  bg?: string
  border?: string
  onChange: (min: number, max: number) => void
}

export function PriceRangeSlider({
  minPrice,
  maxPrice,
  maxValue = 20000,
  step = STEP,
  bg = 'var(--background)',
  border = 'var(--border)',
  onChange,
}: Props) {
  const minPct = (minPrice / maxValue) * 100
  const maxPct = (maxPrice / maxValue) * 100

  function handleMin(e: React.ChangeEvent<HTMLInputElement>) {
    const val = Math.min(Number(e.target.value), maxPrice - step)
    onChange(val, maxPrice)
  }

  function handleMax(e: React.ChangeEvent<HTMLInputElement>) {
    const val = Math.max(Number(e.target.value), minPrice + step)
    onChange(minPrice, val)
  }

  // When min thumb is pushed to the far right, promote it above max thumb
  const minZ = minPrice >= maxPrice - step ? 5 : 4
  const maxZ = minPrice >= maxPrice - step ? 4 : 5

  return (
    <div style={{ position: 'relative', height: '12px', marginTop: '8px' }}>
      {/* Track */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '9999px',
          backgroundColor: bg,
          border: `1px solid ${border}`,
          pointerEvents: 'none',
        }}
      >
        {/* Filled range */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${minPct}%`,
            right: `${100 - maxPct}%`,
            backgroundColor: 'var(--primary)',
            borderRadius: '9999px',
          }}
        />
      </div>

      {/* Min input — track is non-interactive, only thumb captures events */}
      <input
        type="range"
        min={0}
        max={maxValue}
        step={step}
        value={minPrice}
        onChange={handleMin}
        className="absolute w-full h-full appearance-none bg-transparent pointer-events-none m-0 p-0 [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:bg-transparent [&::-webkit-slider-thumb]:border-none [&::-webkit-slider-thumb]:shadow-none [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:bg-transparent [&::-moz-range-thumb]:border-none"
        style={{ zIndex: minZ }}
      />

      {/* Max input — track is non-interactive, only thumb captures events */}
      <input
        type="range"
        min={0}
        max={maxValue}
        step={step}
        value={maxPrice}
        onChange={handleMax}
        className="absolute w-full h-full appearance-none bg-transparent pointer-events-none m-0 p-0 [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:bg-transparent [&::-webkit-slider-thumb]:border-none [&::-webkit-slider-thumb]:shadow-none [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:bg-transparent [&::-moz-range-thumb]:border-none"
        style={{ zIndex: maxZ }}
      />

      {/* Visual min thumb */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: `${minPct}%`,
          transform: 'translate(-50%, -50%)',
          width: '20px',
          height: '20px',
          borderRadius: '50%',
          backgroundColor: 'white',
          boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
          pointerEvents: 'none',
          zIndex: 2,
          flexShrink: 0,
        }}
      />

      {/* Visual max thumb */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: `${maxPct}%`,
          transform: 'translate(-50%, -50%)',
          width: '20px',
          height: '20px',
          borderRadius: '50%',
          backgroundColor: 'white',
          boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
          pointerEvents: 'none',
          zIndex: 2,
          flexShrink: 0,
        }}
      />
    </div>
  )
}
