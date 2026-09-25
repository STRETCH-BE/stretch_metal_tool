/**
 * UI primitives barrel — import from "@/components/ui".
 * File path: /components/ui/index.ts
 *
 * Mixed server-safe and "use client" modules; Next keeps the boundary per
 * file, so a server component may import client primitives from here.
 * Server-only files (none here) must never be added to this barrel.
 */

export { Button } from "./button";
export { Eyebrow } from "./eyebrow";
export { Container } from "./container";
export { SectionTitle } from "./section-title";
export { MetaChip } from "./meta-chip";
export { Logo } from "./logo";

export { StatusChip, type ChipSeverity, type StatusChipProps } from "./status-chip";
export { PlaceholderBadge } from "./placeholder-badge";
export { PageHeader, type PageHeaderProps } from "./page-header";
export { Panel, type PanelProps } from "./panel";
export {
  Field,
  Input,
  Select,
  Textarea,
  describedBy,
  type FieldProps,
  type InputProps,
  type SelectProps,
  type TextareaProps,
} from "./field";
export { NumberInput, type NumberInputProps } from "./number-input";
export { Modal, type ModalProps } from "./modal";
export { ToastProvider, useToast, type ToastOptions, type ToastTone } from "./toast";
export { EmptyState, type EmptyStateProps } from "./empty-state";
export { ConfirmButton, type ConfirmButtonProps } from "./confirm-button";
export { Tabs, type TabItem, type TabsProps } from "./tabs";
export { Kbd } from "./kbd";
export { Spinner, type SpinnerProps } from "./spinner";
export {
  Table,
  TableWrap,
  Th,
  Td,
  type CellAlign,
  type TableProps,
  type ThProps,
  type TdProps,
} from "./table";
export { Pagination, type PaginationProps } from "./pagination";
export { Notice, FormError, type NoticeProps, type NoticeTone } from "./notice";
export { SubmitButton, type SubmitButtonProps } from "./submit-button";
export { interpolate } from "./format";
