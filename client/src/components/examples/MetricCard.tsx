import { MetricCard } from "../MetricCard";
import { DollarSign } from "lucide-react";

export default function MetricCardExample() {
  return (
    <MetricCard
      title="Ventas del Mes"
      value="$4,250.00"
      icon={DollarSign}
      trend={{ value: 12.5, isPositive: true }}
      subtitle="vs mes anterior"
    />
  );
}
