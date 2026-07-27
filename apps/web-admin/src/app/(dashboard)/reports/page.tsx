import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LineChart, BarChart3, PieChart, Download } from "lucide-react";

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Reports & Analytics</h1>
          <p className="text-gray-500">Dive deep into your sales, profitability, and operational metrics.</p>
        </div>
        <Button variant="outline" className="bg-white">
          <Download className="w-4 h-4 mr-2" />
          Download PDF Report
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Mock Chart Cards */}
        <Card className="shadow-xs border-gray-100">
          <CardHeader>
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                <LineChart className="w-5 h-5" />
              </div>
              <CardTitle className="text-lg">Sales Trend</CardTitle>
            </div>
            <CardDescription>Daily revenue for the last 30 days.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-48 flex items-center justify-center border-2 border-dashed border-gray-100 rounded-lg text-gray-400">
              [Line Chart Visualization]
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-xs border-gray-100">
          <CardHeader>
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                <BarChart3 className="w-5 h-5" />
              </div>
              <CardTitle className="text-lg">Top Selling Items</CardTitle>
            </div>
            <CardDescription>Highest revenue generating menu items.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-48 flex items-center justify-center border-2 border-dashed border-gray-100 rounded-lg text-gray-400">
              [Bar Chart Visualization]
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-xs border-gray-100">
          <CardHeader>
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                <PieChart className="w-5 h-5" />
              </div>
              <CardTitle className="text-lg">Revenue by Outlet</CardTitle>
            </div>
            <CardDescription>Distribution of sales across locations.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-48 flex items-center justify-center border-2 border-dashed border-gray-100 rounded-lg text-gray-400">
              [Pie Chart Visualization]
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
