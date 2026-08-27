import { motion } from 'framer-motion'

export const Gallery = ({ items }) => items.map((it) => <motion.img key={it.id} layoutId={`p-${it.id}`} />)
