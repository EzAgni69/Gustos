import React, { useState, useEffect } from "react";
import { type POSTable } from "../../store/useTableStore";
import { apiClient } from "../../api/client";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";

const DatePickerComponent = DatePicker as unknown as React.ComponentType<any>;

interface ReservationModalProps {
  table: POSTable;
  onClose: () => void;
}

interface Reservation {
  id: string;
  customerName: string | null;
  reservationTime: string;
  durationMins: number;
}

export const ReservationModal: React.FC<ReservationModalProps> = ({ table, onClose }) => {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [name, setName] = useState("");
  const [selectedDateTime, setSelectedDateTime] = useState<Date | null>(new Date());
  const [duration, setDuration] = useState("60");
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    fetchReservations();
  }, [table.id]);

  const fetchReservations = async () => {
    setLoading(true);
    try {
      const res = await apiClient<{ success: boolean; data: Reservation[] }>(`/tables/${table.id}/reservations`);
      if (res.success) {
        setReservations(res.data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDateTime) {
      setError("Please select a date and time");
      return;
    }

    const isoTime = selectedDateTime.toISOString();
    
    setError(null);
    try {
      const res = await apiClient<{ success: boolean; message: string }>((`/tables/${table.id}/reservations`), {
        method: "POST",
        body: JSON.stringify({
          customerName: name || null,
          reservationTime: isoTime,
          durationMins: parseInt(duration) || 60,
        })
      });

      if (res.success) {
        fetchReservations();
        setName("");
        setSelectedDateTime(new Date());
      } else {
        setError(res.message);
      }
    } catch (err: any) {
      setError(err.message || "Failed to create reservation");
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border flex justify-between items-center bg-background">
          <div>
            <h2 className="text-lg font-bold text-text-main">Reservations: {table.tableNumber}</h2>
            <p className="text-xs text-text-muted font-mono">Capacity: {table.capacity} Pax</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-surface-hover hover:bg-surface-hover flex items-center justify-center text-text-muted hover:text-text-main"
          >
            ✕
          </button>
        </div>

        <div className="p-6 flex flex-col gap-6">
          {/* New Reservation Form */}
          <form onSubmit={handleBook} className="space-y-4">
            <h3 className="text-sm font-bold text-text-main border-b border-border pb-2">New Booking</h3>
            
            {error && <div className="p-2 bg-red-900/50 text-red-200 text-xs rounded border border-red-800">{error}</div>}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs text-text-muted">Customer Name (Optional)</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-text-main focus:outline-none focus:border-primary"
                  placeholder="e.g. John Doe"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-text-muted">Duration (Mins)</label>
                <input
                  type="number"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-text-main focus:outline-none focus:border-primary"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-text-muted">Date & Time</label>
              <div className="w-full">
                <DatePickerComponent
                  selected={selectedDateTime}
                  onChange={(date: Date | null) => setSelectedDateTime(date)}
                  showTimeSelect
                  timeFormat="HH:mm"
                  timeIntervals={15}
                  timeCaption="Time"
                  dateFormat="MMMM d, yyyy HH:mm"
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-text-main focus:outline-none focus:border-primary"
                  wrapperClassName="w-full"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-primary hover:bg-primary-hover text-text-inverse font-bold py-2 rounded-lg transition-colors text-sm"
            >
              Book Table
            </button>
          </form>

          {/* Existing Reservations */}
          <div>
            <h3 className="text-sm font-bold text-text-main border-b border-border pb-2 mb-3">Active Reservations</h3>
            {loading ? (
              <p className="text-xs text-text-muted">Loading...</p>
            ) : reservations.length === 0 ? (
              <p className="text-xs text-text-muted">No active reservations.</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                {reservations.map((res) => (
                  <div key={res.id} className="bg-background border border-border p-3 rounded flex justify-between items-center">
                    <div>
                      <div className="text-sm font-bold text-text-main">{res.customerName || "Anonymous"}</div>
                      <div className="text-xs text-text-muted font-mono">
                        {new Date(res.reservationTime).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })} ({res.durationMins}m)
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
};
