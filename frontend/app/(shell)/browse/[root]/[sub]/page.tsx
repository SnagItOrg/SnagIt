/**
 * PAN-289 — `/browse/<root>/<kind>` is the root's page with a kind in force:
 * the same client component, which reads the kind from the path. The layout
 * beside this file is what makes it a page of its own (404, canonical).
 */
export { default } from '../page'
