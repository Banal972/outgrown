// Placement only — maps straight onto CSS anchor positioning
import { useFloating, offset, flip, shift } from '@floating-ui/react'

export function Tooltip({ children }) {
  const { refs, floatingStyles } = useFloating({
    placement: 'top',
    middleware: [offset(8), flip(), shift()],
  })
  return (
    <>
      <button ref={refs.setReference}>?</button>
      <div ref={refs.setFloating} style={floatingStyles}>{children}</div>
    </>
  )
}
