import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, TextInput, ScrollView, Alert, TouchableOpacity, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { getTableReservations, createTableReservation, cancelReservation, type ReservationResponse } from "../../src/services/api";
import { colors, spacing, fontSize, fontWeight } from "../../src/config/theme";
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Platform } from 'react-native';

export default function ReserveTableScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [reservations, setReservations] = useState<ReservationResponse[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [dateObj, setDateObj] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [duration, setDuration] = useState("60");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchReservations();
  }, [id]);

  const fetchReservations = async () => {
    try {
      const data = await getTableReservations(id!);
      setReservations(data);
    } catch (e) {
      console.error(e);
      Alert.alert("Error", "Failed to fetch reservations");
    } finally {
      setLoading(false);
    }
  };

  const handleBook = async () => {
    const isoTime = dateObj.toISOString();
    const dur = parseInt(duration) || 60;

    setSubmitting(true);
    try {
      await createTableReservation(id!, name || null, isoTime, dur);
      Alert.alert("Success", "Table reserved successfully.", [
        { text: "OK", onPress: () => router.back() }
      ]);
      setName("");
      fetchReservations();
    } catch (e: any) {
      Alert.alert("Error", e.message || "Could not reserve table. Time slot may be conflicting.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelReservation = (reservationId: string) => {
    Alert.alert("Cancel Reservation", "Are you sure you want to cancel this reservation?", [
      { text: "No", style: "cancel" },
      {
        text: "Yes, Cancel",
        style: "destructive",
        onPress: async () => {
          try {
            await cancelReservation(reservationId);
            Alert.alert("Cancelled", "Reservation has been cancelled.");
            fetchReservations();
          } catch (e: any) {
            Alert.alert("Error", e.message || "Failed to cancel reservation.");
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>New Booking</Text>
      </View>
      <ScrollView style={styles.scrollContainer} contentContainerStyle={styles.content}>
      
      <View style={styles.formGroup}>
        <Text style={styles.label}>Customer Name (Optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. John Doe"
          placeholderTextColor={colors.textSecondary}
          value={name}
          onChangeText={setName}
        />
      </View>

      <View style={styles.row}>
        <View style={[styles.formGroup, { flex: 1 }]}>
          <Text style={styles.label}>Date</Text>
          <TouchableOpacity
            style={styles.input}
            onPress={() => setShowDatePicker(true)}
          >
            <Text style={{ color: colors.textPrimary, fontSize: fontSize.md }}>
              {dateObj.toISOString().split("T")[0]}
            </Text>
          </TouchableOpacity>
          {showDatePicker && (
            <DateTimePicker
              value={dateObj}
              mode="date"
              display="default"
              onChange={(event: DateTimePickerEvent, selectedDate?: Date) => {
                if (Platform.OS === 'android') setShowDatePicker(false);
                if (selectedDate) setDateObj(selectedDate);
              }}
            />
          )}
        </View>
        <View style={[styles.formGroup, { flex: 1, marginLeft: spacing.sm }]}>
          <Text style={styles.label}>Time</Text>
          <TouchableOpacity
            style={styles.input}
            onPress={() => setShowTimePicker(true)}
          >
            <Text style={{ color: colors.textPrimary, fontSize: fontSize.md }}>
              {dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
            </Text>
          </TouchableOpacity>
          {showTimePicker && (
            <DateTimePicker
              value={dateObj}
              mode="time"
              is24Hour={true}
              display="default"
              onChange={(event: DateTimePickerEvent, selectedDate?: Date) => {
                if (Platform.OS === 'android') setShowTimePicker(false);
                if (selectedDate) setDateObj(selectedDate);
              }}
            />
          )}
        </View>
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.label}>Duration (Mins)</Text>
        <TextInput
          style={styles.input}
          placeholder="60"
          placeholderTextColor={colors.textSecondary}
          value={duration}
          onChangeText={setDuration}
          keyboardType="numeric"
        />
      </View>

      <TouchableOpacity 
        style={styles.bookButton}
        onPress={handleBook}
        disabled={submitting}
      >
        <Text style={styles.bookButtonText}>{submitting ? "Booking..." : "Book Table"}</Text>
      </TouchableOpacity>

      <Text style={[styles.sectionTitle, { marginTop: spacing.xl }]}>Active Reservations</Text>
      
      {loading ? (
        <Text style={styles.emptyText}>Loading...</Text>
      ) : reservations.length === 0 ? (
        <Text style={styles.emptyText}>No active reservations.</Text>
      ) : (
        reservations.map((res) => (
          <View key={res.id} style={styles.resCard}>
            <View style={styles.resDetails}>
              <Text style={styles.resName}>{res.customerName || "Anonymous"}</Text>
              <Text style={styles.resTime}>
                {new Date(res.reservationTime).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })} ({res.durationMins} mins)
              </Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.cancelButton, pressed && styles.cancelButtonPressed]}
              onPress={() => handleCancelReservation(res.id)}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
          </View>
        ))
      )}
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollContainer: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.lg,
    paddingTop: 60,
    backgroundColor: colors.bgCard,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: { marginRight: spacing.md, padding: spacing.xs },
  backButtonText: { color: colors.accent, fontSize: fontSize.md, fontWeight: fontWeight.medium },
  title: {
    flex: 1,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  formGroup: {
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  label: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.bgCard,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: spacing.sm,
    fontSize: fontSize.md,
  },
  bookButton: {
    backgroundColor: colors.accent,
    padding: spacing.md,
    borderRadius: 8,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  bookButtonText: {
    color: "#FFF",
    fontWeight: fontWeight.bold,
    fontSize: fontSize.md,
  },
  emptyText: {
    color: colors.textSecondary,
  },
  resCard: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    borderRadius: 8,
    marginBottom: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  resDetails: {
    flex: 1,
  },
  resName: {
    color: colors.textPrimary,
    fontWeight: fontWeight.bold,
    fontSize: fontSize.md,
  },
  resTime: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
  },
  cancelButton: {
    backgroundColor: colors.dangerBg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  cancelButtonPressed: { opacity: 0.8 },
  cancelButtonText: {
    color: colors.danger,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
});
