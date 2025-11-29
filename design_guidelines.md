# Design Guidelines: Mary Kay Inventory & CRM System

## Design Approach

**Selected System:** Material Design adapted for business applications
**Justification:** This is a data-intensive, utility-focused CRM and inventory management system requiring clear information hierarchy, efficient data entry, and robust table/form components. Material Design provides the necessary structure for complex business tools while maintaining a professional, modern aesthetic.

## Typography System

**Primary Font:** Inter or Roboto via Google Fonts CDN
**Hierarchy:**
- Page Titles: text-3xl font-bold (Dashboard, Clientas, Inventario)
- Section Headers: text-xl font-semibold
- Card/Widget Titles: text-lg font-medium
- Body/Table Text: text-base font-normal
- Secondary Info: text-sm text-gray-600
- Labels: text-sm font-medium uppercase tracking-wide

**Data-Specific Typography:**
- Metrics/Numbers: text-2xl or text-3xl font-bold (for KPIs in dashboard)
- Table Headers: text-xs font-semibold uppercase
- Currency Values: tabular-nums for alignment

## Layout System

**Spacing Primitives:** Use Tailwind units of 2, 4, 6, and 8 consistently
- Component padding: p-4 or p-6
- Card spacing: p-6
- Section margins: mb-6 or mb-8
- Grid gaps: gap-4 or gap-6
- Form field spacing: space-y-4

**Grid Structure:**
- Main container: max-w-7xl mx-auto px-4
- Dashboard widgets: grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6
- Multi-column forms: grid grid-cols-1 md:grid-cols-2 gap-4
- Data tables: full-width within container

## Component Library

### Navigation
**Sidebar Navigation (Desktop):**
- Fixed left sidebar (w-64)
- Logo/branding at top
- Navigation items with icons (Heroicons) + labels
- Active state indication with subtle background
- Collapsible sub-menus for categories

**Top Bar:**
- User profile dropdown (right)
- Quick actions/notifications
- Search functionality

### Dashboard Widgets
**Metric Cards (KPI Summary):**
- Shadow card with rounded-lg
- Large number (text-3xl font-bold)
- Label below (text-sm text-gray-600)
- Optional trend indicator (↑ ↓ with percentage)
- Icon in top-right corner

**Chart Cards:**
- Same card style as metrics
- Header with title + filter dropdown
- Chart area using Chart.js or similar
- Types needed: Line (sales trends), Bar (top products), Donut (category distribution)

### Data Tables
**Standard Pattern:**
- Full-width responsive table
- Sticky header (position-sticky top-0)
- Alternating row backgrounds (hover states)
- Action column (right-aligned) with icon buttons
- Pagination footer
- Search/filter bar above table
- Row selection checkboxes for bulk actions

**Client Table Specific:**
- Avatar/initials column
- Name (clickable to detail)
- Purchase count badge
- Category tag/chip
- Last purchase date
- Total spent (right-aligned, tabular-nums)

### Forms
**Structure:**
- White card background with shadow
- Section divisions for grouped fields
- Two-column layout on desktop (grid-cols-2)
- Field groups with space-y-4
- Clear labels above inputs
- Helper text below fields (text-sm text-gray-500)
- Validation states with icons + error messages

**Input Types Needed:**
- Text inputs with leading icons
- Dropdowns/selects
- Date pickers for appointments
- Number inputs for inventory/prices
- Textarea for notes
- File upload for product images
- Tags input for categorization

### Calendar/Agenda View
**Layout:**
- Month view grid as primary
- Day/Week views as alternatives
- Event cards with client name + time
- Color coding by appointment type
- Quick-add button (floating action button)
- Today indicator

### Client Detail View
**Information Architecture:**
- Header card: Client photo, name, contact info, category badge
- Tabbed interface: Perfil | Historial | Citas | Notas
- Purchase history table within tab
- Timeline view for interactions
- Quick actions (Nueva Venta, Agendar Cita, Editar)

### Inventory Management
**Product Cards (Grid View):**
- Product image placeholder
- SKU + Name
- Stock level with badge (color-coded: low/normal/high stock)
- Price display
- Quick action buttons

**Stock Alert Component:**
- Notification banner for low stock items
- List with product name + current quantity
- Quick restock action

## Interaction Patterns

**Primary Actions:** Filled buttons (rounded-lg, px-4 py-2)
**Secondary Actions:** Outlined buttons
**Floating Action Button:** For "Nueva Venta", "Agregar Producto", "Nueva Cita" (fixed bottom-right)

**Modal Dialogs:**
- Backdrop overlay
- Centered card with max-w-2xl
- Header with title + close icon
- Form content with footer actions
- Use for: Add/Edit forms, confirmations

**Notifications:**
- Toast messages (top-right corner)
- Success/Error/Warning states with icons
- Auto-dismiss after 4 seconds

## Responsive Strategy

**Mobile (< 768px):**
- Hamburger menu replaces sidebar
- Single column layouts
- Horizontal scroll for tables
- Stacked metric cards
- Bottom navigation for primary actions

**Desktop (≥ 1024px):**
- Persistent sidebar
- Multi-column grids
- Full table displays
- Hover interactions enabled