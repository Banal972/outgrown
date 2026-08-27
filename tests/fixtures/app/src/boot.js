import 'whatwg-fetch'
import AOS from 'aos'
const Modal = require('react-modal')
const lazy = () => import('framer-motion')

AOS.init()
export { Modal, lazy }
