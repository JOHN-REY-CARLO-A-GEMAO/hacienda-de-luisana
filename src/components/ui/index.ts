/**
 * Shared UI primitives — the design system's public surface.
 *
 * Import from here (not from the individual files) so a primitive can be moved
 * or split without touching every page:
 *
 *   import { Alert, Card, PageHeader } from '../components/ui'
 *
 * Colour, spacing, radius and type tokens live in `src/styles.css`; this module
 * only composes them. A page should not need a Tailwind colour class for
 * anything the tokens already name.
 */
export { Alert, type AlertTone } from './Alert'
export { Card, type CardProps } from './Card'
export { Container, WIDTHS, type Width } from './Container'
export { Drawer, Modal } from './Drawer'
export { EmptyState } from './EmptyState'
export { CheckboxRow, Field, Input, Select, Textarea } from './Field'
export { LoadingPanel, SkeletonLines, Spinner } from './Loading'
export { MessageScreen } from './MessageScreen'
export { Page } from './Page'
export { PageHeader } from './PageHeader'
export { RequestBadge, StatusBadge, StatusIconTile, statusHeadline, statusMeaning, statusTone, type StatusTone } from './StatusBadge'
