// Shared element transition — this one does not map to CSS
import { motion } from 'framer-motion'

export function Gallery({ items }) {
  return items.map((it) => <motion.img key={it.id} layoutId={`photo-${it.id}`} src={it.src} />)
}
