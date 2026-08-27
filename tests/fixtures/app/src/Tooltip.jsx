import { useFloating, offset, flip } from '@floating-ui/react/dist/floating-ui.react.mjs'

export function Tooltip() {
  const { refs } = useFloating({ placement: 'top', middleware: [offset(8), flip()] })
  return refs
}
