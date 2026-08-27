// Enter/exit fade only — two lines of CSS replace this
import { motion, AnimatePresence } from 'framer-motion'

export function Fade({ open, children }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
