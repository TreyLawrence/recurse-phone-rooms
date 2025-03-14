<script lang="ts">
    import { onMount } from "svelte";
    import { db } from "../lib/browserDb";
    import type { Room, Booking } from "../lib/browserDb";
    import { user } from "../lib/auth";

    // Data
    let rooms: Room[] = [];
    let bookings: Booking[] = [];
    let isLoading = true;
    let error: string | null = null;

    // Calendar state
    const now = new Date();
    let currentDate = new Date();
    let weekDays: Date[] = [];

    // Time slots - 15 minute intervals for full day
    const hours = Array.from({ length: 24 }, (_, i) => i); // 0am to 11pm (full 24 hours)
    const minutes = [0, 15, 30, 45];
    const timeSlots = hours.flatMap((hour) =>
        minutes.map((minute) => ({ hour, minute })),
    );

    // Booking form
    let selectedRoom: Room | null = null;
    let selectedDate: Date | null = null;
    let selectedStartTime: string = "9:00";
    let selectedEndTime: string = "9:30";
    let selectedDuration: string = "30"; // Default 30 minutes
    let selectedRoomId: number | null = null;
    let bookingNotes = "";
    let showBookingForm = false;
    let bookingSuccess = false;
    let bookingError: string | null = null;
    let isSubmitting = false;

    // Drag interaction state
    let isDragging = false;
    let dragStartY = 0;
    let dragCurrentY = 0;
    let dragRoom: Room | null = null;
    let dragDay: Date | null = null;

    // Add this variable to track the modal element
    let bookingModalElement: HTMLDivElement;

    // Add these variables after the booking form variables
    let selectedBooking: Booking | null = null;
    let showBookingDetails = false;
    let isDeletingBooking = false;

    // Helper functions for booking display
    function getBookingPosition(booking: Booking): number {
        const startTime = new Date(booking.start_time);
        const hour = startTime.getHours();
        const minutes = startTime.getMinutes();

        // Calculate position based on hours and minutes from 8am
        // For a 15px per 15-minute grid, each minute is 1px
        const position = (hour - 8) * 60 + minutes;

        console.log("Booking position:", {
            id: booking.id,
            startTime: startTime.toLocaleString(),
            hour,
            minutes,
            position,
            pixels: position,
        });

        return position;
    }

    function getBookingHeight(booking: Booking): number {
        const startTime = new Date(booking.start_time);
        const endTime = new Date(booking.end_time);

        // Calculate duration in minutes
        const durationMs = endTime.getTime() - startTime.getTime();
        const durationMinutes = durationMs / (1000 * 60);

        // DEBUG: Uncomment to debug height issues
        console.log("Booking height:", {
            id: booking.id,
            startTime: startTime.toLocaleString(),
            endTime: endTime.toLocaleString(),
            durationMs,
            durationMinutes,
        });

        // Return height in pixels (1 minute = 1px)
        return durationMinutes;
    }

    // Load data
    async function loadData() {
        try {
            isLoading = true;
            error = null;

            const [roomsData, bookingsData] = await Promise.all([
                db.getRooms(),
                db.getBookings(),
            ]);

            rooms = roomsData;

            // Fetch user details for each booking if not already included
            const bookingsWithUserDetails = await Promise.all(
                bookingsData.map(async (booking) => {
                    // If we already have user details, just return the booking
                    if (booking.user_name) {
                        return booking;
                    }

                    try {
                        // Try to get user details from the API
                        const response = await fetch(
                            `/api/users/${booking.user_id}`,
                        );
                        if (response.ok) {
                            const userData = await response.json();
                            return {
                                ...booking,
                                user_name: userData.name || "Unknown User",
                                user_email: userData.email,
                            };
                        }
                    } catch (err) {
                        console.error("Failed to fetch user details:", err);
                    }

                    // Fallback: Use the current user's name if the ID matches
                    if ($user && parseInt($user.id) === booking.user_id) {
                        return {
                            ...booking,
                            user_name: $user.name || "You",
                            user_email: $user.email,
                        };
                    }

                    // Otherwise just mark as unknown user
                    return {
                        ...booking,
                        user_name: "Unknown User",
                    };
                }),
            );

            bookings = bookingsWithUserDetails;

            // DEBUG: Log the loaded bookings
            console.log("Loaded bookings with user details:", bookings);

            if (bookings.length > 0) {
                // Log all booking times in a readable format for debugging
                bookings.forEach((booking) => {
                    const start = new Date(booking.start_time);
                    console.log(
                        `Booking ID ${booking.id}: ${start.toLocaleTimeString()} by ${booking.user_name}`,
                    );
                });
            }

            // Generate the week view
            generateWeekView();
        } catch (err) {
            console.error("Error loading data:", err);
            error =
                err instanceof Error
                    ? err.message
                    : "Failed to load calendar data";
        } finally {
            isLoading = false;
        }
    }

    onMount(() => {
        loadData();

        // Event listeners for drag events
        window.addEventListener("mouseup", handleMouseUp);
        window.addEventListener("mousemove", handleMouseMove);

        // Add keyboard event listener for Escape key to close modals
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                if (showBookingForm) {
                    closeBookingForm();
                }
                if (showBookingDetails) {
                    closeBookingDetails();
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);

        // Scroll to business hours (8am) on initial load
        setTimeout(() => {
            const calendarGrid = document.querySelector(".calendar-grid");
            if (calendarGrid) {
                // Scroll to 8am (8 hours * 4 quarters * 20px per quarter = 640px)
                calendarGrid.scrollTop = 640;
            }
        }, 100);

        return () => {
            window.removeEventListener("mouseup", handleMouseUp);
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("keydown", handleKeyDown);
        };
    });

    // Generate the week view
    function generateWeekView() {
        // Reset week days
        weekDays = [];

        // Get the start of the week (Sunday)
        const startOfWeek = new Date(currentDate);
        startOfWeek.setDate(currentDate.getDate() - currentDate.getDay());

        // Generate the 7 days of the week
        for (let i = 0; i < 7; i++) {
            const day = new Date(startOfWeek);
            day.setDate(startOfWeek.getDate() + i);
            weekDays.push(day);
        }

        // DEBUG: Log the current week range
        console.log("Week range:", {
            startOfWeek: weekDays[0].toDateString(),
            endOfWeek: weekDays[6].toDateString(),
            today: new Date().toDateString(),
            currentDate: currentDate.toDateString(),
        });
    }

    // Navigation functions
    function goToToday() {
        currentDate = new Date();
        generateWeekView();
    }

    function prevWeek() {
        currentDate.setDate(currentDate.getDate() - 7);
        currentDate = new Date(currentDate);
        generateWeekView();
    }

    function nextWeek() {
        currentDate.setDate(currentDate.getDate() + 7);
        currentDate = new Date(currentDate);
        generateWeekView();
    }

    // Helper functions
    function isToday(date: Date): boolean {
        const today = new Date();
        return (
            date.getDate() === today.getDate() &&
            date.getMonth() === today.getMonth() &&
            date.getFullYear() === today.getFullYear()
        );
    }

    function isWeekend(date: Date): boolean {
        const day = date.getDay();
        return day === 0 || day === 6; // Sunday or Saturday
    }

    function formatDate(date: Date): string {
        return date.toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
        });
    }

    // Format a time for display
    function formatTime(hour: number, minute: number): string {
        // Handle midnight (0) as 12 AM
        const hourDisplay = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
        const period = hour >= 12 ? "PM" : "AM";
        const minuteDisplay =
            minute === 0 ? "" : `:${minute.toString().padStart(2, "0")}`;
        return `${hourDisplay}${minuteDisplay} ${period}`;
    }

    // Format a time from a Date object
    function formatTimeFromDate(date: Date | string): string {
        const dateObj = new Date(date);
        return formatTime(dateObj.getHours(), dateObj.getMinutes());
    }

    // Drag functions
    function handleMouseDown(e: MouseEvent, room: Room | null, day: Date) {
        isDragging = true;
        dragStartY = e.clientY;
        dragCurrentY = e.clientY;
        dragRoom = room;
        dragDay = day;

        // Prevent default to avoid text selection
        e.preventDefault();
    }

    function handleMouseMove(e: MouseEvent) {
        if (!isDragging) return;
        dragCurrentY = e.clientY;
    }

    function handleMouseUp() {
        if (!isDragging || !dragDay) return;

        // Convert drag position to time
        const selection = getDragSelection();
        if (!selection) {
            isDragging = false;
            return;
        }

        // Calculate start hour and end hour based on selection
        const startHourFraction = selection.startHour;
        const endHourFraction = selection.endHour;

        // Parse to hours and minutes
        const startHour = Math.floor(startHourFraction);
        const startMinute = Math.round((startHourFraction - startHour) * 60);
        const endHour = Math.floor(endHourFraction);
        const endMinute = Math.round((endHourFraction - endHour) * 60);

        // Format times for the time inputs
        selectedStartTime = `${startHour}:${startMinute.toString().padStart(2, "0")}`;
        selectedEndTime = `${endHour}:${endMinute.toString().padStart(2, "0")}`;

        // Set selected date and open room selection
        selectedDate = new Date(dragDay);
        selectedRoom = dragRoom; // This might be null, which is fine

        // Open booking form
        showBookingForm = true;

        // Reset drag state
        isDragging = false;
    }

    function getDragSelection() {
        if (!isDragging || !dragDay) return null;

        const calendar = document.querySelector(".calendar-grid");
        if (!calendar) return null;

        const currentDragDay = dragDay; // Assign to local variable for TypeScript
        if (!currentDragDay) return null; // Extra safety check

        // Find the day column that corresponds to the drag day
        const dayColumn = Array.from(
            document.querySelectorAll(".day-column"),
        ).find((col) => {
            // Get the corresponding day from weekDays based on column index
            const parent = col.parentElement;
            if (!parent) return false;

            const colIndex = Array.from(parent.children).indexOf(col) - 2; // Adjust for corner and time column
            if (colIndex < 0 || colIndex >= weekDays.length) return false;

            const columnDay = weekDays[colIndex];
            const dragDayString = currentDragDay.toDateString();
            return columnDay.toDateString() === dragDayString;
        });

        if (!dayColumn) return null;

        const dayRect = dayColumn.getBoundingClientRect();

        // Calculate relative positions within the day column
        const startY = Math.min(dragStartY, dragCurrentY) - dayRect.top;
        const endY = Math.max(dragStartY, dragCurrentY) - dayRect.top;

        // Convert to hour fractions (assuming 60px per hour)
        const hourHeight = 60;
        const startHour = Math.max(0, startY / hourHeight);
        const endHour = Math.min(24, endY / hourHeight);

        return {
            startHour,
            endHour,
            top: startY,
            height: endY - startY,
        };
    }

    // Let's create a function to directly show the booking form modal
    function forceShowBookingForm() {
        // First make sure state is correctly set
        showBookingForm = true;

        // Then explicitly manipulate the DOM if we have a reference to the modal
        setTimeout(() => {
            if (bookingModalElement) {
                console.log("Directly making modal visible via DOM");
                bookingModalElement.style.display = "flex";
                bookingModalElement.style.opacity = "1";
                bookingModalElement.style.pointerEvents = "auto";
            }
        }, 20);
    }

    function handleTimeSlotClick(
        day: Date,
        hour: number,
        minute: number,
        room: Room | null,
    ) {
        console.log("Time slot clicked:", hour, minute);
        selectedDate = new Date(day);
        selectedRoom = room;
        selectedStartTime = `${hour}:${minute === 0 ? "00" : minute}`;

        // Default to a 30-minute meeting
        let endHour = hour;
        let endMinute = minute + 30;

        // Adjust if we cross the hour boundary
        if (endMinute >= 60) {
            endHour += 1;
            endMinute -= 60;
        }

        selectedEndTime = `${endHour}:${endMinute === 0 ? "00" : endMinute}`;
        bookingNotes = "";
        bookingSuccess = false;
        bookingError = null;
        showBookingForm = true;
    }

    // Open the booking form
    function openBookingForm(date: Date) {
        selectedDate = date;
        showBookingForm = true;
        bookingNotes = "";
        bookingSuccess = false;
        bookingError = null;
        selectedDuration = "30"; // Default to 30 minutes
        selectedRoomId = null; // Reset room selection
    }

    // Close the booking form
    function closeBookingForm() {
        showBookingForm = false;
        selectedDate = null;
        selectedRoom = null;
        selectedRoomId = null;
    }

    async function handleBookingSubmit() {
        if (!$user || !selectedDate || !selectedStartTime || !selectedRoomId) {
            bookingError = "Please fill out all required fields";
            return;
        }

        try {
            isSubmitting = true;
            bookingError = null;

            // Parse the start time
            const [startHour, startMinute] = selectedStartTime
                .split(":")
                .map(Number);

            // Create Date objects for start time
            const startTime = new Date(selectedDate);
            startTime.setHours(startHour, startMinute, 0, 0);

            // Calculate end time based on duration
            const endTime = new Date(startTime);
            endTime.setMinutes(
                startTime.getMinutes() + parseInt(selectedDuration),
            );

            // Get the selected room
            const room = rooms.find((r) => r.id === selectedRoomId);
            if (!room) {
                bookingError = "Invalid room selection";
                return;
            }

            // Check if time slot is available
            const isAvailable = await db.isTimeSlotAvailable(
                selectedRoomId,
                startTime,
                endTime,
            );

            if (!isAvailable) {
                bookingError =
                    "This time slot is already booked. Please select a different time.";
                return;
            }

            // Create the booking
            const booking = {
                user_id: parseInt($user.id),
                room_id: selectedRoomId,
                start_time: startTime,
                end_time: endTime,
                notes: bookingNotes,
            };

            await db.createBooking(booking);

            // Refresh bookings data
            await loadData();

            // Show success message
            bookingSuccess = true;

            // Close the form after a delay
            setTimeout(() => {
                closeBookingForm();
            }, 2000);
        } catch (err) {
            console.error("Booking error:", err);
            bookingError =
                err instanceof Error
                    ? err.message
                    : "Failed to create booking. Please try again.";
        } finally {
            isSubmitting = false;
        }
    }

    // Check for bookings in a time slot - improved with better approach
    function getBookingAt(date: Date, hour: number, minute: number): Booking[] {
        const slotTime = new Date(date);
        slotTime.setHours(hour, minute, 0, 0);

        const slotEndTime = new Date(slotTime);
        slotEndTime.setMinutes(slotEndTime.getMinutes() + 15);

        // Apply filter to find matching bookings
        const results = bookings.filter((booking) => {
            const startTime = new Date(booking.start_time);
            const endTime = new Date(booking.end_time);

            // Check if this booking is within the current slot time and day
            const isWithinTimeRange =
                slotTime < endTime && slotEndTime > startTime;
            const isSameDay =
                slotTime.toDateString() === startTime.toDateString();

            // Uncomment temporarily to debug specific slots
            if ((hour === 9 || hour === 10 || hour === 11) && minute === 0) {
                console.log(
                    `Debug slot ${date.toDateString()} ${hour}:${minute}`,
                    {
                        booking: `${booking.id} (${new Date(booking.start_time).toLocaleString()})`,
                        slotTime: slotTime.toLocaleString(),
                        slotEndTime: slotEndTime.toLocaleString(),
                        bookingStart: startTime.toLocaleString(),
                        bookingEnd: endTime.toLocaleString(),
                        isWithinTimeRange,
                        isSameDay,
                        matched: isWithinTimeRange && isSameDay,
                    },
                );
            }

            return isWithinTimeRange && isSameDay;
        });

        // More verbose logging to help debugging
        if (results.length > 0) {
            console.log(
                `Found ${results.length} bookings for ${date.toDateString()} at ${hour}:${minute}`,
                results.map(
                    (b) =>
                        `ID: ${b.id}, Room: ${b.room_id}, Time: ${new Date(b.start_time).toLocaleString()}`,
                ),
            );
        }

        return results;
    }

    // Get room color for display
    function getRoomColor(roomId: number): string {
        // Find the room object by ID
        const room = rooms.find((r) => r.id === roomId);
        if (!room) return "#4f46e5"; // Default color if room not found

        // Assign specific colors based on room name
        if (room.name.toLowerCase().includes("green")) {
            return "#16a34a"; // Green color for Green Phone Room
        } else if (room.name.toLowerCase().includes("lovelace")) {
            return "#bf0000"; // Gules (heraldic red) for Lovelace
        }

        // Fallback colors if needed
        const index = rooms.findIndex((r) => r.id === roomId);
        const colors = ["#4f46e5", "#16a34a"];
        return colors[index % colors.length];
    }

    // Sign out
    function handleSignOut() {
        import("../lib/auth").then(({ signOut }) => {
            signOut();
        });
    }

    // Helper to check if there are concurrent bookings at the same time
    function hasConcurrentBookings(bookings: Booking[]): boolean {
        // If there are multiple bookings and their time ranges overlap, they're concurrent
        if (bookings.length <= 1) return false;

        // Check if the bookings are for different rooms
        const roomIds = new Set(bookings.map((b) => b.room_id));
        return roomIds.size > 1;
    }

    // Helper to calculate duration in a human-readable format
    function formatDuration(startTime: string, endTime: string): string {
        const [startHour, startMinute] = startTime.split(":").map(Number);
        const [endHour, endMinute] = endTime.split(":").map(Number);

        // Calculate total minutes
        const startTotalMinutes = startHour * 60 + startMinute;
        const endTotalMinutes = endHour * 60 + endMinute;
        let durationMinutes = endTotalMinutes - startTotalMinutes;

        // Handle overnight bookings (not typical for a room booking system, but just in case)
        if (durationMinutes <= 0) {
            durationMinutes += 24 * 60;
        }

        const hours = Math.floor(durationMinutes / 60);
        const mins = durationMinutes % 60;

        if (hours === 0) {
            return `${mins} minute${mins !== 1 ? "s" : ""}`;
        } else if (mins === 0) {
            return `${hours} hour${hours !== 1 ? "s" : ""}`;
        } else {
            return `${hours} hour${hours !== 1 ? "s" : ""} ${mins} minute${mins !== 1 ? "s" : ""}`;
        }
    }

    // Helper function to check if a booking is the start of a time slot - Fixed with exact time comparison
    function isBookingStart(
        booking: Booking,
        day: Date,
        hour: number,
        minute: number,
    ): boolean {
        const startTime = new Date(booking.start_time);
        const slotTime = new Date(day);
        slotTime.setHours(hour, minute, 0, 0);

        // Compare hours and minutes directly for more accurate matching
        const sameHour = startTime.getHours() === hour;
        const sameMinute = startTime.getMinutes() === minute;
        const sameDay = startTime.toDateString() === slotTime.toDateString();

        // Debug logging for 9:15 time slot
        if (
            (hour === 9 && minute === 15) ||
            (startTime.getHours() === 9 && startTime.getMinutes() === 15)
        ) {
            console.log(`Detailed comparison for 9:15 booking:`, {
                bookingStart: `${startTime.getHours()}:${startTime.getMinutes()}`,
                slotTime: `${hour}:${minute}`,
                sameHour,
                sameMinute,
                sameDay,
                match: sameHour && sameMinute && sameDay,
            });
        }

        return sameHour && sameMinute && sameDay;
    }

    // Add this function to handle clicking on a booking
    function handleBookingClick(booking: Booking) {
        selectedBooking = booking;
        showBookingDetails = true;
    }

    // Add this function to handle booking deletion
    async function handleDeleteBooking() {
        if (!selectedBooking) return;

        try {
            isDeletingBooking = true;
            await db.deleteBooking(selectedBooking.id);

            // Close the modal and refresh the data
            showBookingDetails = false;
            selectedBooking = null;

            // Refresh the calendar data
            await loadData();
        } catch (err) {
            console.error("Error deleting booking:", err);
            error =
                err instanceof Error ? err.message : "Failed to delete booking";
        } finally {
            isDeletingBooking = false;
        }
    }

    // Close the booking details modal
    function closeBookingDetails() {
        showBookingDetails = false;
        selectedBooking = null;
    }

    // Handle delete booking confirmation
    async function confirmDeleteBooking() {
        if (!selectedBooking || !$user) return;

        try {
            isSubmitting = true;

            await db.deleteBooking(selectedBooking.id);

            // Refresh data
            await loadData();

            closeBookingDetails();
        } catch (err) {
            console.error("Error deleting booking:", err);
            // Handle error
        } finally {
            isSubmitting = false;
        }
    }

    // Handle day cell click
    function onDayClick(date: Date) {
        openBookingForm(date);
    }
</script>

<div class="bg-gray-900 min-h-screen text-white overflow-x-hidden w-screen">
    <!-- Sign Out button fixed at top right -->
    <div
        class="fixed top-2 right-4 z-[100] left-auto"
        style="position: fixed !important; right: 1rem !important; left: auto !important;"
    >
        <button
            on:click={handleSignOut}
            class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-md text-white text-sm"
            style="background-color: #2563eb !important;"
        >
            Sign Out
        </button>
    </div>

    <div class="w-screen max-w-full px-4 py-2">
        <!-- Centered title -->
        <h1 class="text-2xl font-bold text-center mb-4 mt-2">
            Phone Room Calendar
        </h1>

        {#if isLoading}
            <div class="flex justify-center my-10">
                <div
                    class="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"
                ></div>
            </div>
        {:else if error}
            <div
                class="bg-red-900 border border-red-700 text-red-100 px-4 py-3 rounded relative mb-4"
            >
                <strong class="font-bold">Error!</strong>
                <span class="block sm:inline">{error}</span>
                <button
                    class="bg-red-800 text-white px-4 py-2 rounded-md mt-2"
                    on:click={loadData}>Retry</button
                >
            </div>
        {:else if rooms.length === 0}
            <div
                class="bg-yellow-900 border border-yellow-700 text-yellow-100 px-4 py-3 rounded relative mb-4"
            >
                <strong class="font-bold">No Rooms Available</strong>
                <span class="block sm:inline"
                    >No phone rooms were found in the system.</span
                >
            </div>
        {:else}
            <div class="bg-gray-900 border border-gray-800 rounded-lg p-2">
                <!-- Calendar Navigation -->
                <div class="flex flex-col mb-4">
                    <div class="flex justify-between items-center px-4">
                        <!-- Left aligned navigation buttons -->
                        <div class="flex space-x-2">
                            <button
                                on:click={goToToday}
                                class="px-4 py-2 bg-gray-800 text-white rounded-md hover:bg-gray-700"
                            >
                                Today
                            </button>
                            <button
                                on:click={prevWeek}
                                class="w-10 h-10 bg-gray-700 text-white rounded-md hover:bg-gray-600 flex items-center justify-center"
                                aria-label="Previous Week"
                            >
                                ←
                            </button>
                            <button
                                on:click={nextWeek}
                                class="w-10 h-10 bg-gray-700 text-white rounded-md hover:bg-gray-600 flex items-center justify-center"
                                aria-label="Next Week"
                            >
                                →
                            </button>
                        </div>

                        <!-- Centered month/year display -->
                        <h2 class="text-xl font-medium text-white">
                            {new Date(weekDays[0]).toLocaleDateString("en-US", {
                                month: "long",
                                year: "numeric",
                            })}
                        </h2>

                        <!-- Room Legend - Positioned to the right -->
                        <div class="flex items-center gap-3">
                            {#each rooms as room}
                                <div
                                    class="booking-legend-item"
                                    style="background-color: {getRoomColor(
                                        room.id,
                                    )};
                                          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
                                          border: 1px solid rgba(255, 255, 255, 0.2);
                                          border-radius: 4px;
                                          padding: 2px 8px;
                                          min-width: 100px;
                                          text-align: center;"
                                >
                                    <span
                                        class="text-white text-sm font-medium"
                                        style="text-shadow: 0px 1px 2px rgba(0, 0, 0, 0.5);"
                                        >{room.name}</span
                                    >
                                </div>
                            {/each}
                        </div>
                    </div>
                </div>

                <!-- Calendar Grid - Global view with side-by-side concurrent events -->
                <div class="calendar-grid">
                    <!-- Empty corner cell -->
                    <div class="corner-header"></div>

                    <!-- Day headers -->
                    {#each weekDays as day}
                        <div
                            class="day-header {isToday(day)
                                ? 'today'
                                : ''} {isWeekend(day) ? 'weekend' : ''}"
                        >
                            <div class="day-name">
                                {day.toLocaleDateString("en-US", {
                                    weekday: "short",
                                })}
                            </div>
                            <div class="day-number">{day.getDate()}</div>
                        </div>
                    {/each}

                    <!-- Time column -->
                    <div class="time-column">
                        {#each timeSlots as slot, i}
                            <div
                                class="time-label {slot.minute === 0
                                    ? 'hour-label'
                                    : 'minute-label'}"
                                data-hour={slot.hour}
                                data-minute={slot.minute}
                            >
                                {#if slot.minute === 0}
                                    <span class="time-text">
                                        {slot.hour > 12
                                            ? slot.hour - 12
                                            : slot.hour}
                                        {slot.hour >= 12 ? "PM" : "AM"}
                                    </span>
                                {/if}
                            </div>
                        {/each}
                    </div>

                    <!-- Day columns -->
                    {#each weekDays as day}
                        <div
                            class="day-column {isToday(day)
                                ? 'today-column'
                                : ''} {isWeekend(day) ? 'weekend-column' : ''}"
                        >
                            <!-- Time slots - 15 minute increments -->
                            {#each timeSlots as slot}
                                <div
                                    class="time-cell {slot.minute === 0
                                        ? 'hour-start'
                                        : ''}"
                                    data-hour={slot.hour}
                                    data-minute={slot.minute}
                                    on:mousedown={(e) =>
                                        handleMouseDown(e, null, day)}
                                    on:click={() => {
                                        handleTimeSlotClick(
                                            day,
                                            slot.hour,
                                            slot.minute,
                                            null,
                                        );
                                    }}
                                    role="button"
                                    tabindex="0"
                                    aria-label="Create booking at {formatTime(
                                        slot.hour,
                                        slot.minute,
                                    )} on {formatDate(day)}"
                                    on:keydown={(e) => {
                                        if (e.key === "Enter" || e.key === " ")
                                            handleTimeSlotClick(
                                                day,
                                                slot.hour,
                                                slot.minute,
                                                null,
                                            );
                                    }}
                                >
                                    {#if true}
                                        {@const hourBookings = getBookingAt(
                                            day,
                                            slot.hour,
                                            slot.minute,
                                        )}
                                        {@const hasOverlap =
                                            hasConcurrentBookings(hourBookings)}

                                        {#each hourBookings as booking, index}
                                            <div
                                                class="booking-display"
                                                style="
                                                    background-color: {getRoomColor(
                                                    booking.room_id,
                                                )} !important;
                                                    /* Calculate top position: only show if this is the actual start slot */
                                                    display: {isBookingStart(
                                                    booking,
                                                    day,
                                                    slot.hour,
                                                    slot.minute,
                                                )
                                                    ? 'flex'
                                                    : 'none'};
                                                    height: {getBookingHeight(
                                                    booking,
                                                )}px;
                                                    {hasOverlap
                                                    ? `width: calc(100% / ${hourBookings.length}); left: calc(${index} * (100% / ${hourBookings.length}));`
                                                    : 'left: 2px; right: 2px;'}
                                                "
                                                on:click|stopPropagation={() =>
                                                    handleBookingClick(booking)}
                                                role="button"
                                                tabindex="0"
                                                on:keydown={(e) => {
                                                    if (
                                                        e.key === "Enter" ||
                                                        e.key === " "
                                                    )
                                                        handleBookingClick(
                                                            booking,
                                                        );
                                                }}
                                            >
                                                <!-- Google Calendar style event display -->
                                                <div class="booking-title">
                                                    {#if hasOverlap}
                                                        {rooms.find(
                                                            (r) =>
                                                                r.id ===
                                                                booking.room_id,
                                                        )?.name}:
                                                    {/if}
                                                    {booking.notes || `Booking`}
                                                </div>
                                                <div class="booking-user">
                                                    {booking.user_name ||
                                                        (booking.user_id ===
                                                        parseInt(
                                                            $user?.id || "0",
                                                        )
                                                            ? $user?.name ||
                                                              "You"
                                                            : "Unknown User")}
                                                </div>
                                            </div>
                                        {/each}
                                    {/if}

                                    {#if isDragging && dragDay && dragDay.toDateString() === day.toDateString()}
                                        {@const selection = getDragSelection()}
                                        {#if selection}
                                            <div
                                                class="drag-selection"
                                                style="
                                                    top: {selection.top}px;
                                                    height: {selection.height}px;
                                                "
                                            ></div>
                                        {/if}
                                    {/if}
                                </div>
                            {/each}
                        </div>
                    {/each}
                </div>
            </div>
        {/if}
    </div>

    <!-- Booking Form Modal -->
    <div
        bind:this={bookingModalElement}
        class="booking-modal-overlay"
        style={showBookingForm && selectedDate
            ? "display: flex;"
            : "display: none;"}
    >
        <div class="booking-modal-content">
            <!-- Close button at top right -->
            <button
                on:click={closeBookingForm}
                class="modal-close-btn"
                aria-label="Close"
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="w-6 h-6"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                >
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M6 18L18 6M6 6l12 12"
                    />
                </svg>
            </button>

            {#if bookingSuccess}
                <div class="text-center py-6">
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="w-12 h-12 mx-auto text-green-400 mb-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M5 13l4 4L19 7"
                        />
                    </svg>
                    <h3 class="text-xl font-medium text-white mb-2">
                        Meeting scheduled
                    </h3>
                    <p class="text-gray-300">Your booking has been confirmed</p>
                    <button
                        on:click={closeBookingForm}
                        class="mt-4 inline-flex justify-center px-4 py-2 text-sm font-medium text-blue-400 hover:text-blue-300"
                    >
                        Close
                    </button>
                </div>
            {:else}
                <div class="pt-8 mb-4">
                    <h3 class="text-xl font-medium text-white text-center">
                        Book a Room
                    </h3>
                </div>

                <form
                    on:submit|preventDefault={handleBookingSubmit}
                    class="space-y-4"
                >
                    <!-- Date Display -->
                    <div class="flex items-center gap-2 mb-4">
                        <div class="text-gray-400">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                class="w-5 h-5"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                            >
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                                />
                            </svg>
                        </div>
                        <div class="text-white font-medium">
                            {selectedDate ? formatDate(selectedDate) : ""}
                        </div>
                    </div>

                    <!-- Time Selection -->
                    <div class="mb-4">
                        <label class="block text-gray-400 mb-2"
                            >Start Time</label
                        >
                        <select
                            bind:value={selectedStartTime}
                            class="w-full bg-gray-700 border-none rounded-md focus:ring-1 focus:ring-blue-500 p-2 text-white"
                        >
                            {#each hours as hour}
                                {#each [0, 15, 30, 45] as minute}
                                    <option
                                        value={`${hour}:${minute === 0 ? "00" : minute}`}
                                    >
                                        {formatTime(hour, minute)}
                                    </option>
                                {/each}
                            {/each}
                        </select>
                    </div>

                    <!-- Duration Selection -->
                    <div class="mb-4">
                        <label class="block text-gray-400 mb-2">Duration</label>
                        <select
                            bind:value={selectedDuration}
                            class="w-full bg-gray-700 border-none rounded-md focus:ring-1 focus:ring-blue-500 p-2 text-white"
                        >
                            <option value="15">15 minutes</option>
                            <option value="30">30 minutes</option>
                            <option value="45">45 minutes</option>
                            <option value="60">1 hour</option>
                            <option value="90">1 hour 30 minutes</option>
                            <option value="120">2 hours</option>
                        </select>
                    </div>

                    <!-- Room Selection -->
                    <div class="mb-4">
                        <label class="block text-gray-400 mb-2"
                            >Select Room</label
                        >
                        <div class="flex space-x-3">
                            {#each rooms as room}
                                <button
                                    type="button"
                                    on:click={() => (selectedRoomId = room.id)}
                                    class="flex-1 py-3 px-4 text-center rounded-md transition-colors font-medium {selectedRoomId ===
                                    room.id
                                        ? 'bg-blue-600 hover:bg-blue-700 text-white'
                                        : 'bg-gray-700 hover:bg-gray-600 text-white'}"
                                >
                                    {room.name}
                                </button>
                            {/each}
                        </div>
                    </div>

                    <!-- Notes field -->
                    <div class="mb-4">
                        <label class="block text-gray-400 mb-2"
                            >Notes (optional)</label
                        >
                        <textarea
                            bind:value={bookingNotes}
                            class="w-full bg-gray-700 border-none rounded-md p-2 text-white focus:ring-1 focus:ring-blue-500 resize-none"
                            rows="2"
                            placeholder="Add description"
                        ></textarea>
                    </div>

                    {#if bookingError}
                        <div
                            class="bg-red-900 border border-red-700 text-white px-4 py-3 rounded"
                        >
                            <strong class="font-bold">Error:</strong>
                            <span class="block sm:inline">{bookingError}</span>
                        </div>
                    {/if}

                    <div
                        class="flex justify-end pt-4 border-t border-gray-700 space-x-3"
                    >
                        <button
                            type="button"
                            on:click={closeBookingForm}
                            class="px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700 rounded-md"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md shadow-sm"
                            disabled={isSubmitting || !selectedRoomId}
                        >
                            {isSubmitting ? "Saving..." : "Book Room"}
                        </button>
                    </div>
                </form>
            {/if}
        </div>
    </div>

    <!-- Booking Details Modal -->
    <div
        class="booking-modal-overlay"
        style={showBookingDetails && selectedBooking
            ? "display: flex;"
            : "display: none;"}
    >
        <div class="booking-modal-content">
            <!-- Close button at top right -->
            <button
                on:click={closeBookingDetails}
                class="modal-close-btn"
                aria-label="Close"
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="w-6 h-6"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                >
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M6 18L18 6M6 6l12 12"
                    />
                </svg>
            </button>

            <div class="pt-8 mb-4">
                <h3 class="text-xl font-medium text-white text-center">
                    Booking Details
                </h3>
            </div>

            {#if selectedBooking}
                <div class="space-y-4">
                    <div class="grid grid-cols-[auto,1fr] gap-4 items-center">
                        <!-- Room Icon -->
                        <div class="text-gray-400">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                class="w-5 h-5"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                            >
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                                />
                            </svg>
                        </div>
                        <div class="text-white">
                            {#if selectedBooking}
                                {rooms.find(
                                    (r) => r.id === selectedBooking?.room_id,
                                )?.name || "Unknown Room"}
                            {:else}
                                Unknown Room
                            {/if}
                        </div>

                        <!-- Calendar Icon -->
                        <div class="text-gray-400">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                class="w-5 h-5"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                            >
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                                />
                            </svg>
                        </div>
                        <div class="text-white">
                            {formatDate(new Date(selectedBooking.start_time))}
                        </div>

                        <!-- Time Icon -->
                        <div class="text-gray-400">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                class="w-5 h-5"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                            >
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                                />
                            </svg>
                        </div>
                        <div class="text-white">
                            {formatTimeFromDate(selectedBooking.start_time)} - {formatTimeFromDate(
                                selectedBooking.end_time,
                            )}
                        </div>

                        <!-- Person Icon -->
                        <div class="text-gray-400">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                class="w-5 h-5"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                            >
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                                />
                            </svg>
                        </div>
                        <div class="text-white">
                            {selectedBooking.user_name || "Unknown User"}
                        </div>

                        {#if selectedBooking.notes}
                            <!-- Notes Icon -->
                            <div class="text-gray-400 self-start pt-2">
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    class="w-5 h-5"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                >
                                    <path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        stroke-width="2"
                                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                    />
                                </svg>
                            </div>
                            <div class="text-white pb-2">
                                {selectedBooking.notes}
                            </div>
                        {/if}
                    </div>

                    {#if $user && parseInt($user.id) === selectedBooking.user_id}
                        <div class="pt-4 border-t border-gray-700">
                            <button
                                on:click={confirmDeleteBooking}
                                class="w-full mt-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-md shadow-sm"
                                disabled={isSubmitting}
                            >
                                {isSubmitting
                                    ? "Deleting..."
                                    : "Delete Booking"}
                            </button>
                        </div>
                    {/if}
                </div>
            {/if}
        </div>
    </div>
</div>

<style>
    /* New grid layout styles - maximize width */
    .calendar-grid {
        display: grid;
        grid-template-columns: 60px repeat(7, 1fr);
        grid-auto-rows: auto;
        border: 1px solid #333;
        border-radius: 0.375rem;
        overflow: scroll;
        background-color: #1a1a1a;
        width: 100vw;
        max-width: 100vw;
        height: calc(100vh - 140px);
        margin: 0;
        padding: 0;
        box-sizing: border-box;
        border-left: none;
        border-right: none;
    }

    /* Ensure fullscreen behavior */
    :global(body),
    :global(html),
    :global(#app) {
        width: 100vw;
        max-width: 100vw;
        margin: 0;
        padding: 0;
        overflow-x: hidden;
    }

    /* Make the overall calendar container take full width with minimal margin */
    .bg-gray-900.border.border-gray-800.rounded-lg.p-4,
    .bg-gray-900.border.border-gray-800.rounded-lg.p-2 {
        margin: 0;
        width: 100vw;
        max-width: 100vw;
        padding: 1px;
        box-sizing: border-box;
        border-left: none;
        border-right: none;
    }

    /* Google Calendar style grid with dark theme - unified view */
    .gcal-grid {
        display: grid;
        grid-template-columns: 80px repeat(7, 1fr);
        grid-auto-rows: 60px;
        border: 1px solid #333;
        border-radius: 0.375rem;
        overflow: hidden;
    }

    .gcal-corner {
        grid-column: 1;
        grid-row: 1;
        border-bottom: 1px solid #333;
        border-right: 1px solid #333;
        background-color: #1a1a1a;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .time-placeholder {
        font-size: 0.75rem;
        color: #9ca3af;
    }

    .time-label-col {
        grid-column: 1;
        border-right: 1px solid #333;
        border-bottom: 1px solid #333;
        background-color: #1a1a1a;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        padding-right: 10px;
    }

    .time-text {
        font-size: 0.875rem;
        color: #9ca3af;
    }

    .time-cell {
        position: relative;
        border-top: 1px solid #222; /* Changed from bottom to top border */
        border-bottom: none;
        min-height: 15px;
        height: 15px;
        background-color: #1a1a1a;
        transition: background-color 0.2s;
        cursor: pointer;
    }

    .time-cell:hover {
        background-color: rgba(66, 133, 244, 0.1);
    }

    .add-event-area {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        cursor: pointer;
    }

    .add-event-area:hover {
        background-color: rgba(79, 70, 229, 0.05);
    }

    .booking-display {
        position: absolute;
        border-radius: 4px;
        padding: 4px 6px;
        font-size: 0.8rem;
        color: white;
        z-index: 10;
        overflow: hidden;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
        display: flex;
        flex-direction: column;
        background-color: #4285f4; /* Default color if specific color not applied */
        text-shadow: 0px 1px 2px rgba(0, 0, 0, 0.5); /* Add text shadow for better readability */
        border: 1px solid rgba(255, 255, 255, 0.2); /* Add subtle border */
        box-sizing: border-box;
    }

    .booking-title {
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .booking-time {
        font-size: 0.75rem;
        opacity: 0.9;
    }

    .booking-user {
        font-size: 0.75rem;
        opacity: 0.9;
        font-style: italic;
    }

    .booking-notes {
        font-size: 0.65rem;
        opacity: 0.9;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .drag-selection {
        position: absolute;
        left: 2px;
        right: 2px;
        background-color: rgba(66, 133, 244, 0.3);
        border: 2px dashed #4285f4;
        border-radius: 4px;
        z-index: 5;
        pointer-events: none;
        animation: pulse 1.5s infinite;
    }

    @keyframes pulse {
        0% {
            opacity: 0.5;
        }
        50% {
            opacity: 0.8;
        }
        100% {
            opacity: 0.5;
        }
    }

    .day-header {
        padding: 8px;
        text-align: center;
        border-bottom: 1px solid #333;
        border-right: 1px solid #333;
        background-color: #1a1a1a;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
    }

    .day-name {
        font-size: 0.875rem;
        color: #e2e8f0;
        font-weight: 500;
    }

    .day-number {
        font-size: 1.25rem;
        font-weight: 600;
        color: #fff; /* Brighter color for better visibility */
        margin-top: 4px;
    }

    .today {
        background-color: rgba(79, 70, 229, 0.1);
    }

    .weekend {
        background-color: rgba(255, 0, 0, 0.05);
    }

    .today-cell {
        background-color: rgba(79, 70, 229, 0.05);
    }

    .weekend-cell {
        background-color: rgba(255, 0, 0, 0.02);
    }

    /* Modal styles */
    .booking-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
    }

    .booking-modal-content {
        background-color: #1f2937;
        border-radius: 0.5rem;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
        padding: 1.5rem;
        width: 100%;
        max-width: 28rem;
        max-height: calc(100vh - 4rem);
        overflow-y: auto;
    }

    /* Fix icon sizes in modal */
    .booking-modal-content svg {
        width: 20px;
        height: 20px;
    }

    .booking-modal-content .h-12 {
        width: 48px;
        height: 48px;
    }

    .booking-modal-content .h-6 {
        width: 24px;
        height: 24px;
    }

    .booking-modal-content .h-5 {
        width: 20px;
        height: 20px;
    }

    /* Improve form inputs */
    .booking-modal-content input,
    .booking-modal-content select,
    .booking-modal-content textarea {
        font-size: 0.875rem;
        padding: 0.5rem;
    }

    .booking-modal-content button {
        font-size: 0.875rem;
    }

    /* New grid layout styles - Dark theme to match Google Calendar */
    .calendar-grid {
        display: grid;
        grid-template-columns: 60px repeat(7, 1fr); /* Reduce time column to 60px, let day columns expand */
        grid-auto-rows: auto;
        border: 1px solid #333; /* Darker border for the outer edge */
        border-radius: 0.5rem;
        overflow: scroll;
        background-color: #1a1a1a;
        width: 100vw; /* Use viewport width */
        max-width: 100vw; /* Ensure it doesn't exceed viewport */
        height: calc(100vh - 140px); /* Make taller */
        margin: 0; /* Remove any default margin */
        padding: 0; /* Remove any default padding */
        box-sizing: border-box; /* Ensure box sizing is consistent */
        border-left: none; /* Remove left border */
        border-right: none; /* Remove right border */
    }

    .corner-header {
        grid-column: 1;
        grid-row: 1;
        background-color: #1a1a1a;
        border-bottom: 1px solid #333; /* Darker border */
        border-right: 1px solid #333; /* Darker border */
    }

    .day-header {
        grid-row: 1;
        padding: 8px;
        text-align: center;
        background-color: #1a1a1a;
        border-bottom: 1px solid #333; /* Darker border */
        border-right: 1px solid #333; /* Darker border */
    }

    .time-column {
        grid-column: 1;
        grid-row: 2 / span 96; /* 24 hours * 4 quarters */
        display: grid;
        grid-template-rows: repeat(96, 20px); /* Updated for 24 hours */
        background-color: #1a1a1a;
        border-right: 1px solid #333; /* Darker border */
        overflow: hidden; /* Ensure no content overflows */
        width: 60px; /* Set explicit width to match grid template */
    }

    .time-label {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        padding-right: 4px;
        height: 15px !important;
        min-height: 15px !important;
        max-height: 15px !important;
        box-sizing: border-box !important;
        border-top: 1px solid #333; /* Changed from bottom to top border */
        border-bottom: none;
        font-size: 0.75rem;
        color: #a0aec0;
        overflow: hidden;
        white-space: nowrap;
        line-height: 15px;
    }

    .time-text {
        display: inline-block;
        font-size: 0.75rem;
        line-height: 1;
        vertical-align: middle;
    }

    .hour-label {
        border-top: 1px solid #444; /* Changed from bottom to top - more visible for hour lines */
        border-bottom: none;
        font-weight: 500;
    }

    .minute-label {
        border-top: 1px solid #222; /* Changed from bottom to top - subtle for 15-min intervals */
        border-bottom: none;
    }

    .day-column {
        display: grid;
        grid-template-rows: repeat(96, 20px); /* Updated for 24 hours */
        border-right: 1px solid #333; /* Darker border */
        min-width: 0; /* Allows columns to shrink below content size if needed */
        width: calc(
            (100vw - 60px) / 7
        ); /* Calculate exact width for each column */
    }

    .room-column {
        display: none; /* Hide old room columns that are no longer used */
    }

    .room-header {
        display: none; /* Hide old room headers that are no longer used */
    }

    .time-cell {
        position: relative;
        border-top: 1px solid #222; /* Changed from bottom to top border */
        border-bottom: none;
        min-height: 15px;
        height: 15px;
        background-color: #1a1a1a;
        transition: background-color 0.2s;
        cursor: pointer;
    }

    .hour-start {
        border-top: 1px solid #444; /* More visible for hour boundaries */
        border-bottom: none;
    }

    .time-cell:hover {
        background-color: rgba(66, 133, 244, 0.1);
    }

    .today-column .time-cell {
        background-color: rgba(66, 133, 244, 0.05);
    }

    .weekend-column .time-cell {
        background-color: #1e1e1e;
    }

    /* Google Calendar style for events */
    .booking-display {
        position: absolute;
        border-radius: 4px;
        padding: 4px 6px;
        font-size: 0.8rem;
        color: white;
        z-index: 10;
        overflow: hidden;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
        display: flex;
        flex-direction: column;
        background-color: #4285f4; /* Default color if specific color not applied */
        text-shadow: 0px 1px 2px rgba(0, 0, 0, 0.5); /* Add text shadow for better readability */
        border: 1px solid rgba(255, 255, 255, 0.2); /* Add subtle border */
        box-sizing: border-box;
    }

    .booking-title {
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .booking-time {
        font-size: 0.75rem;
        opacity: 0.9;
    }

    /* Google Calendar style selection */
    .drag-selection {
        position: absolute;
        left: 2px;
        right: 2px;
        background-color: rgba(66, 133, 244, 0.3);
        border: 2px dashed #4285f4;
        border-radius: 4px;
        z-index: 5;
        pointer-events: none;
        animation: pulse 1.5s infinite;
    }

    @keyframes pulse {
        0% {
            opacity: 0.5;
        }
        50% {
            opacity: 0.8;
        }
        100% {
            opacity: 0.5;
        }
    }

    /* Modal dark theme */
    .booking-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.7);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 50;
    }

    .booking-modal-content {
        background-color: #2d3748;
        border-radius: 8px;
        padding: 16px;
        width: 400px;
        max-width: 90vw;
        max-height: 90vh;
        overflow-y: auto;
        color: white;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    }

    /* Adjust the corner header and day header heights to match */
    .corner-header,
    .day-header {
        height: 60px; /* Fixed height to match grid template */
    }

    /* Add horizontal hour grid lines across all days */
    .day-column .hour-start::before {
        content: "";
        position: absolute;
        top: -1px; /* Align with the top border */
        left: 0;
        right: 0;
        height: 1px;
        background-color: #444; /* Same color as the hour-start border */
        pointer-events: none; /* Don't interfere with clicks */
        z-index: 2; /* Above cells but below events */
    }

    /* Add the modal close button styling */
    .modal-close-btn {
        position: absolute;
        top: 12px;
        right: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #9ca3af; /* gray-400 */
        transition: color 0.2s;
        z-index: 10;
        background: transparent;
        border: none;
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;
    }

    .modal-close-btn:hover {
        color: #d1d5db; /* gray-300 */
        background-color: rgba(255, 255, 255, 0.05);
    }

    /* Make sure the modal content has position relative for proper absolute positioning */
    .booking-modal-content {
        position: relative;
        background-color: #2d3748;
        border-radius: 8px;
        padding: 16px;
        width: 400px;
        max-width: 90vw;
        max-height: 90vh;
        overflow-y: auto;
        color: white;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    }
</style>
