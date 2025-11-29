# Mary Kay Manager - Sistema de Gestión de Inventario y CRM

## Overview
Sistema web profesional para gestión de inventario, ventas y clientes diseñado específicamente para negocios Mary Kay. Incluye dashboard con métricas, gestión de productos, CRM de clientas con categorización, registro de ventas, agenda de citas y reportes visuales.

## Current State
**Phase:** Frontend Prototype
**Status:** Functional prototype with mock data

## Architecture

### Frontend (React + Vite)
- **Framework:** React with TypeScript
- **Routing:** wouter
- **UI Components:** shadcn/ui + Tailwind CSS
- **Charts:** Recharts
- **State Management:** React useState (local state)
- **Data Fetching:** TanStack Query (prepared for backend)

### Pages
1. **Dashboard** (`/`) - Overview con KPIs, gráficos de ventas, alertas de stock
2. **Productos** (`/productos`) - Gestión de inventario con CRUD
3. **Clientas** (`/clientas`) - CRM con datos personales, historial, categorización
4. **Ventas** (`/ventas`) - Registro y seguimiento de ventas
5. **Agenda** (`/agenda`) - Calendario de citas con clientas
6. **Reportes** (`/reportes`) - Análisis y tendencias del negocio

### Key Components
- `AppSidebar` - Navegación principal
- `ThemeToggle` - Cambio modo claro/oscuro
- `MetricCard` - Tarjetas de KPIs
- `ProductCard` / `ProductDialog` - Gestión de productos
- `ClientCard` / `ClientDialog` / `ClientDetailSheet` - Gestión de clientas
- `SaleCard` / `SaleDialog` - Registro de ventas
- `AppointmentCard` / `AppointmentDialog` - Gestión de citas
- `StockAlert` - Alertas de stock bajo

### Design System
- **Primary Color:** Rosa Mary Kay (HSL 330)
- **Font:** Open Sans
- **Border Radius:** Rounded (0.5rem)
- **Theme:** Light/Dark mode support

## Next Phase (Backend)
- Implementar base de datos PostgreSQL
- API REST para productos, clientas, ventas, citas
- Persistencia de datos
- Autenticación de usuario

## User Preferences
- Idioma: Español
- Enfoque: Negocio Mary Kay
- Prioridad: CRM con agenda y categorización de clientas
