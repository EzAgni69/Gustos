import React, { useEffect, useState } from "react";
import { X, Calendar } from "lucide-react";
import { apiClient } from "../../api/client";

interface Reservation {
  id: string;
  tableId: string;
  tableName?: string;
  customerName: string | null;
  reservationTime: string;
  durationMins: number;
}

interface GlobalReservationsModalProps {
  onClose: () => void;
}

export const GlobalReservationsModal: React.FC<GlobalReservationsModalProps> = ({
  onClose,
}) => {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchReservations();
  }, []);

  const fetchReservations = async () => {
    try {
      setLoading(true);
      const res = await apiClient<{ success: boolean; data: Reservation[] }>("/tables/reservations");
      if (res.success) {
        setReservations(res.data);
      }
    } catch (e) {
      console.error("Failed to fetch reservations", e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex justify-between items-center bg-background">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500 border border-blue-500/20">
              <Calendar size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-text-main">All Bookings</h2>
              <div className="text-xs text-text-muted font-mono">Future & Active Reservations</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-text-muted hover:text-text-main hover:bg-surface-hover rounded-xl transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex justify-center items-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : reservations.length === 0 ? (
            <div className="text-center py-12 text-text-muted">
              <Calendar size={48} className="mx-auto mb-4 opacity-20" />
              <p>No upcoming reservations found.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {reservations.map((res) => (
                <div key={res.id} className="bg-background border border-border rounded-xl p-4 flex justify-between items-center hover:border-border-hover transition-colors">
                  <div>
                    <div className="text-sm font-bold text-text-main">{res.tableName || `Table ${res.tableId}`}</div>
                    <div className="text-sm text-text-muted mt-1">{res.customerName || "Anonymous"}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-blue-600">
                      {new Date(res.reservationTime).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}
                    </div>
                    <div className="text-xs text-text-muted mt-1 font-mono">{res.durationMins} mins duration</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
