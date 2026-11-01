import { Armchair, Bike, BookOpen, Coffee, Dumbbell, Headphones, Shapes, Shirt } from "lucide-react";
const icons = { Armchair, Bike, BookOpen, Coffee, Dumbbell, Headphones, Shapes, Shirt };
export function CategoryIcon({ name, className }: { name: string; className?: string }) { const Icon = icons[name as keyof typeof icons] ?? Shapes; return <Icon className={className} aria-hidden="true" />; }
