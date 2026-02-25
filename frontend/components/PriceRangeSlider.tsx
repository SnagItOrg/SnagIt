'use client'

const PRI  = '#13ec6d'
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
  bg = '#102218',
  border = '#326748',
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
  const minZ = minPrice >= maxPrice - step ? 5 : 3

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
            backgroundColor: PRI,
            borderRadius: '9999px',
          }}
        />
      </div>

      {/* Invisible min input */}
      <input
        type="range"
        min={0}
        max={maxValue}
        step={step}
        value={minPrice}
        onChange={handleMin}
        style={{
          position: 'absolute',
          width: '100%',
          height: '100%',
          opacity: 0,
          cursor: 'pointer',
          zIndex: minZ,
          margin: 0,
          padding: 0,
        }}
      />

      {/* Invisible max input */}
      <input
        type="range"
        min={0}
        max={maxValue}
        step={step}
        value={maxPrice}
        onChange={handleMax}
        style={{
          position: 'absolute',
          width: '100%',
          height: '100%',
          opacity: 0,
          cursor: 'pointer',
          zIndex: 4,
          margin: 0,
          padding: 0,
        }}
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
