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

    // Track the last created booking's start time for scroll
    let lastCreatedBookingStart: Date | null = null;

    // Helper functions for booking display
    function getBookingPosition(booking: Booking): number {
        const startTime = new Date(booking.start_time);
        const hour = startTime.getHours();
        const minutes = startTime.getMinutes();

        // Calculate position based on hours and minutes from 8am
        // For a 15px per 15-minute grid, each minute is 1px
        const position = (hour - 8) * 60 + minutes;

        // console.log("Booking position:", { id: booking.id, position });

        return position;
    }

    function getBookingHeight(booking: Booking): number {
        const startTime = new Date(booking.start_time);
        const endTime = new Date(booking.end_time);

        // Calculate duration in minutes
        const durationMs = endTime.getTime() - startTime.getTime();
        const durationMinutes = durationMs / (1000 * 60);

        // console.log("Booking height:", { id: booking.id, durationMinutes });

        // Return height in pixels (1 minute = 1px)
        return durationMinutes ;
    }

    // Load data

     async function retry() {
        // console.log("retrying")
        import("../lib/auth").then(({ signOut, initiateOAuthLogin }) => {
            signOut();
            initiateOAuthLogin();
        });
    }

    async function loadData() {
        try{    
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
            // console.log("Loaded bookings with user details:", bookings);

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

            // After data is loaded, scroll to the last created booking if set
            if (lastCreatedBookingStart) {
                setTimeout(() => {
                    scrollCalendarToTime(lastCreatedBookingStart!);
                    lastCreatedBookingStart = null;
                }, 100);
            }
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

        // Initial scroll to current time will be handled by generateWeekView

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

        // After generating week view, scroll to current time if it's today
        setTimeout(() => {
            scrollToCurrentTimeIfToday();
        }, 100);
    }

    // Navigation functions
    function goToToday() {
        currentDate = new Date(); // Always reset to current date/time
        generateWeekView(); // This will auto-scroll to current time
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

            // Track the start time for scroll after reload
            lastCreatedBookingStart = new Date(startTime);

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
        if (!room) return "#6366f1"; // Default color if room not found

        // Assign specific colors based on room name - solid colors for consistency
        if (room.name.toLowerCase().includes("green")) {
            return "#588157"; // Green
        } else if (room.name.toLowerCase().includes("lovelace")) {
            return "#ffafcc"; // Pastel pink
        }

        // Fallback colors if needed
        const index = rooms.findIndex((r) => r.id === roomId);
        const colors = ["#588157", "#ffafcc"];
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

    // Utility to scroll calendar grid to a specific time (hour, minute)
    function scrollCalendarToTime(date: Date) {
        const calendarGrid = document.querySelector(".calendar-grid");
        if (!calendarGrid) return;
        // Each hour = 60px, each minute = 1px (15min slot = 15px)
        const hour = date.getHours();
        const minute = date.getMinutes();
        const scrollTop = hour * 60 + minute;
        calendarGrid.scrollTop = scrollTop;
    }

    // Scroll to current time only if today is visible in the current week
    function scrollToCurrentTimeIfToday() {
        const today = new Date();
        const todayString = today.toDateString();
        
        // Check if today is in the current week view
        const isCurrentWeek = weekDays.some(day => day.toDateString() === todayString);
        
        if (isCurrentWeek) {
            scrollCalendarToTime(today);
            console.log("Scrolled to current time:", today.toLocaleTimeString());
        }
    }
</script>

<div class="calendar-app bg-slate-50 min-h-screen text-gray-900 overflow-x-hidden flex flex-col items-center w-full">
    

    <!-- Legend and Title Group -->
    <div class="calendar-above-grid w-full max-w-[1100px] flex flex-col items-center mb-4">

        <h1 class="calendar-title text-3xl font-bold text-center mb-2 mt-2 tracking-tight">
            <svg xmlns="http://www.w3.org/2000/svg" class="inline-block align-middle mr-3" width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="vertical-align: middle; filter: drop-shadow(0 2px 12px rgba(59,130,246,0.3));">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
            Phone Room Calendar
        </h1>
    </div>

    <main class="calendar-main w-full max-w-[1100px] px-4 py-2 flex flex-col items-center">
        {#if isLoading}
            <div class="calendar-loading flex justify-center my-12">
                <div class="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
        {:else if error}
            <div class="calendar-error bg-red-50 border border-red-200 text-red-800 px-6 py-4 rounded-xl relative mb-6 shadow-sm">
                <strong class="font-semibold">Error!</strong>
                <span class="block sm:inline ml-1">{error}</span>
                <button class="btn-base btn-md btn-danger mt-3" on:click={retry}>
                    <svg xmlns="http://www.w3.org/2000/svg"  fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Retry
                </button>
            </div>
        {:else if rooms.length === 0}
            <div class="calendar-no-rooms bg-amber-50 border border-amber-200 text-amber-800 px-6 py-4 rounded-xl relative mb-6 shadow-sm">
                <strong class="font-semibold">No Rooms Available</strong>
                <span class="block sm:inline ml-1">No phone rooms were found in the system.</span>
            </div>
        {:else}
            <section class="calendar-section bg-white border border-gray-200 rounded-xl p-6 w-full max-w-[1100px] mx-auto" style="height: 70vh;">
                <header class="calendar-month-header mb-6 flex items-center gap-4 justify-between px-4 flex-wrap">
                    <div class="flex items-center gap-8">
                        <h2 class="calendar-month text-2xl font-semibold text-gray-800 tracking-tight">
                            {new Date(weekDays[0]).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                        </h2>
                        <!-- Move legend here -->
                        <div class="calendar-legend flex items-center gap-4">
                            {#each rooms as room}
                                <div class="calendar-legend-item legend-button">
                                    <span class="legend-circle {room.name.toLowerCase().includes('green') ? 'circle-green' : room.name.toLowerCase().includes('lovelace') ? 'circle-lovelace' : ''}" aria-hidden="true"></span>
                                    <span class="text-sm font-medium text-gray-800">{room.name}</span>
                                </div>
                            {/each}
                        </div>
                    </div>
                    <div class="calendar-nav flex items-center gap-3 flex-shrink-0">
                        <button
                            on:click={goToToday}
                            class="btn-base btn-md calendar-nav-today"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg"  fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            Today
                        </button>
                        <button
                            on:click={prevWeek}
                            class="btn-base btn-nav-icon"
                            aria-label="Previous Week"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg"  fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                            </svg>
                        </button>
                        <button
                            on:click={nextWeek}
                            class="btn-base btn-nav-icon"
                            aria-label="Next Week"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg"  fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                            </svg>
                        </button>
                        <button
                        on:click={handleSignOut}
                        class="btn-base btn-md calendar-signout"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg"  fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                        Sign Out
                    </button>
                    </div>
                </header>
                <div class="calendar-grid" style="width: 100%; height: 60vh;">
                    <div class="calendar-corner corner-header"></div>
                    {#each weekDays as day}
                        <div class="calendar-day-header day-header {isToday(day) ? 'today' : ''} {isWeekend(day) ? 'weekend' : ''}">
                            <div class="calendar-day-name day-name">{day.toLocaleDateString("en-US", { weekday: "short" })}</div>
                            <div class="calendar-day-number day-number">{day.getDate()}</div>
                        </div>
                    {/each}
                    <aside class="calendar-sidebar time-column">
                        {#each timeSlots as slot, i}
                            <div
                                class="calendar-time-label time-label {slot.minute === 0 ? 'hour-label' : 'minute-label'}"
                                data-hour={slot.hour}
                                data-minute={slot.minute}
                            >
                                {#if slot.minute === 0}
                                    <span class="calendar-time-text time-text">
                                        {slot.hour > 12 ? slot.hour - 12 : slot.hour}{slot.hour >= 12 ? "PM" : "AM"}
                                    </span>
                                {/if}
                            </div>
                        {/each}
                    </aside>
                    {#each weekDays as day}
                        <section class="calendar-day day-column {isToday(day) ? 'today-column' : ''} {isWeekend(day) ? 'weekend-column' : ''}">
                            {#each timeSlots as slot}
                                <div
                                    class="calendar-slot time-cell {slot.minute === 0 ? 'hour-start' : ''}"
                                    data-hour={slot.hour}
                                    data-minute={slot.minute}
                                    on:mousedown={(e) => handleMouseDown(e, null, day)}
                                    on:click={() => { handleTimeSlotClick(day, slot.hour, slot.minute, null); }}
                                    role="button"
                                    tabindex="0"
                                    aria-label="Create booking at {formatTime(slot.hour, slot.minute)} on {formatDate(day)}"
                                    on:keydown={(e) => { if (e.key === "Enter" || e.key === " ") handleTimeSlotClick(day, slot.hour, slot.minute, null); }}
                                >
                                    {#if true}
                                        {@const hourBookings = getBookingAt(day, slot.hour, slot.minute)}
                                        {@const hasOverlap = hasConcurrentBookings(hourBookings)}
                                        {#each hourBookings as booking, index}
                                            {@const bookingHeight = getBookingHeight(booking)}
                                            {@const bookingDuration = bookingHeight} <!-- 1px = 1min -->
                                            <div
                                                class="calendar-event booking-display {rooms.find((r) => r.id === booking.room_id)?.name.toLowerCase().includes('green') ? 'room-green' : rooms.find((r) => r.id === booking.room_id)?.name.toLowerCase().includes('lovelace') ? 'room-lovelace' : ''}"
                                                style="background: {getRoomColor(booking.room_id)} !important; display: {isBookingStart(booking, day, slot.hour, slot.minute) ? 'flex' : 'none'}; height: {bookingHeight}px; {hasOverlap ? `width: calc(100% / ${hourBookings.length}); left: calc(${index} * (100% / ${hourBookings.length}));` : 'left: 2px; right: 2px;'}; min-height: 15px;"
                                                on:click|stopPropagation={() => handleBookingClick(booking)}
                                                role="button"
                                                tabindex="0"
                                                on:keydown={(e) => { if (e.key === "Enter" || e.key === " ") handleBookingClick(booking); }}
                                            >
                                                {#if bookingDuration > 45}
                                                    <div class="calendar-event-title booking-title" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%;">
                                                        {#if hasOverlap}
                                                            {rooms.find((r) => r.id === booking.room_id)?.name}:
                                                        {/if}
                                                        {booking.notes || `Booking`}
                                                    </div>
                                                    <div class="calendar-event-user booking-user" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%;">
                                                        {booking.user_name || (booking.user_id === parseInt($user?.id || "0") ? $user?.name || "You" : "Unknown User")}
                                                    </div>
                                                {:else}
                                                    <div class="calendar-event-user booking-user" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%;">
                                                        {booking.user_name || (booking.user_id === parseInt($user?.id || "0") ? $user?.name || "You" : "Unknown User")}
                                                    </div>
                                                {/if}
                                            </div>
                                        {/each}
                                    {/if}
                                    {#if isDragging && dragDay && dragDay.toDateString() === day.toDateString()}
                                        {@const selection = getDragSelection()}
                                        {#if selection}
                                            <div class="calendar-drag-selection drag-selection" style="top: {selection.top}px; height: {selection.height}px;"></div>
                                        {/if}
                                    {/if}
                                </div>
                            {/each}
                        </section>
                    {/each}
                </div>
            </section>
        {/if}
    </main>

    <!-- Recurse Center Attribution -->
    <footer class="recurse-footer mt-8 mb-6 flex flex-col items-center">
        <div class="flex items-center space-x-3">
            <span class="text-sm text-black font-semibold">Built for the <a href="https://www.recurse.com" target="_blank" rel="noopener noreferrer" class="recurse-link">Recurse Center</a></span>
        </div>
    </footer>

    <!-- Booking Form Modal -->
    <div
        bind:this={bookingModalElement}
        class="modal booking-modal-overlay"
        role="dialog"
        aria-modal="true"
        style={showBookingForm && selectedDate ? "display: flex;" : "display: none;"}
    >
        <div class="modal-content booking-modal-content">
            <button on:click={closeBookingForm} class="modal-close-btn" aria-label="Close">
                <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
            {#if bookingSuccess}
                <div class="modal-success-content">
                    <div class="text-center pt-6 pb-8">
                        <h3 class="modal-success-title mb-6">Meeting Scheduled</h3>
                        <div class="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4 mx-auto">
                            <svg xmlns="http://www.w3.org/2000/svg" class="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                            </svg>
                        </div>
                        <p class="modal-success-text">Your booking has been confirmed</p>
                    </div>
                </div>
            {:else}
                <div class="modal-header pt-8 mb-6">
                    <h3>Book a Room</h3>
                </div>
                <form on:submit|preventDefault={handleBookingSubmit} class="modal-form space-y-4">
                    <div class="modal-date flex items-center gap-3 mb-6">
                        <div class="text-gray-500">
                            <svg xmlns="http://www.w3.org/2000/svg"  fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                        </div>
                        <div class="modal-date-value">{selectedDate ? formatDate(selectedDate) : ""}</div>
                    </div>
                    <div class="modal-time mb-5">
                        <label>Start Time</label>
                        <select bind:value={selectedStartTime} class="modal-input">
                            {#each hours as hour}
                                {#each [0, 15, 30, 45] as minute}
                                    <option value={`${hour}:${minute === 0 ? "00" : minute}`}>{formatTime(hour, minute)}</option>
                                {/each}
                            {/each}
                        </select>
                    </div>
                    <div class="modal-duration mb-5">
                        <label>Duration</label>
                        <select bind:value={selectedDuration} class="modal-input">
                            <option value="15">15 minutes</option>
                            <option value="30">30 minutes</option>
                            <option value="45">45 minutes</option>
                            <option value="60">1 hour</option>
                            <option value="90">1 hour 30 minutes</option>
                            <option value="120">2 hours</option>
                        </select>
                    </div>
                    <div class="modal-room mb-6">
                        <label>Select Room</label>
                        <div class="flex space-x-3">
                            {#each rooms as room}
                                <button
                                    type="button"
                                    on:click={() => (selectedRoomId = room.id)}
                                    class="flex-1 py-3 px-4 text-center rounded-md transition-colors font-medium {room.name.toLowerCase().includes('green') ? 'room-green' : room.name.toLowerCase().includes('lovelace') ? 'room-lovelace' : ''} {selectedRoomId === room.id ? 'room-selected' : 'room-unselected'}"
                                    aria-pressed={selectedRoomId === room.id}
                                >
                                    {room.name}
                                </button>
                            {/each}
                        </div>
                    </div>
                    <div class="modal-notes mb-6">
                        <label>Notes (optional)</label>
                        <textarea bind:value={bookingNotes} class="modal-input" rows="3" placeholder="Add description for your booking..."></textarea>
                    </div>
                    {#if bookingError}
                        <div class="modal-error bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                            <strong class="font-semibold">Error:</strong>
                            <span class="block sm:inline ml-1">{bookingError}</span>
                        </div>
                    {/if}
                    <div class="modal-actions flex justify-end pt-6 border-t border-gray-200 space-x-3">
                        <button type="button" on:click={closeBookingForm} class="btn-base btn-md btn-secondary">
                            <svg xmlns="http://www.w3.org/2000/svg"  fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                            Cancel
                        </button>
                        <button type="submit" class="btn-base btn-md btn-primary" disabled={isSubmitting || !selectedRoomId}>
                            {#if isSubmitting}
                                <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                                </svg>
                                Saving...
                            {:else}
                                <svg xmlns="http://www.w3.org/2000/svg"  fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                                </svg>
                                Book Room
                            {/if}
                        </button>
                    </div>
                </form>
            {/if}
        </div>
    </div>

    <!-- Booking Details Modal -->
    <div
        class="modal booking-modal-overlay"
        role="dialog"
        aria-modal="true"
        style={showBookingDetails && selectedBooking ? "display: flex;" : "display: none;"}
    >
        <div class="modal-content booking-modal-content">
            <button on:click={closeBookingDetails} class="modal-close-btn" aria-label="Close">
                <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
            <div class="modal-header pt-8 mb-6">
                <h3>Booking Details</h3>
            </div>
            {#if selectedBooking}
                <div class="modal-details space-y-4">
                    <div class="modal-details-grid grid grid-cols-[auto,1fr] gap-4 items-center">
                        <div class="modal-icon">
                            <svg xmlns="http://www.w3.org/2000/svg"  fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                            </svg>
                        </div>
                        <div class="modal-value">
                            {#if selectedBooking}
                                {rooms.find((r) => r.id === selectedBooking?.room_id)?.name || "Unknown Room"}
                            {:else}
                                Unknown Room
                            {/if}
                        </div>
                        <div class="modal-icon">
                            <svg xmlns="http://www.w3.org/2000/svg"  fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                        </div>
                        <div class="modal-value">{formatDate(new Date(selectedBooking.start_time))}</div>
                        <div class="modal-icon">
                            <svg xmlns="http://www.w3.org/2000/svg"  fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </div>
                        <div class="modal-value">{formatTimeFromDate(selectedBooking.start_time)} - {formatTimeFromDate(selectedBooking.end_time)}</div>
                        <div class="modal-icon">
                            <svg xmlns="http://www.w3.org/2000/svg"  fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                        </div>
                        <div class="modal-value">{selectedBooking.user_name || "Unknown User"}</div>
                        {#if selectedBooking.notes}
                            <div class="modal-icon self-start pt-2">
                                <svg xmlns="http://www.w3.org/2000/svg"  fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                            </div>
                            <div class="modal-value pb-2">{selectedBooking.notes}</div>
                        {/if}
                    </div>
                    {#if $user && parseInt($user.id) === selectedBooking.user_id}
                        <div class="modal-delete pt-4 border-t border-gray-700">
                            <button on:click={confirmDeleteBooking} class="btn-base btn-md btn-danger w-full" disabled={isDeletingBooking}>
                                {#if isDeletingBooking}
                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                                    </svg>
                                    Deleting...
                                {:else}
                                    <svg xmlns="http://www.w3.org/2000/svg"  fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                    Delete Booking
                                {/if}
                            </button>
                        </div>
                    {/if}
                </div>
            {/if}
        </div>
    </div>
</div>

<style>
    /* ===== MODERN LIGHT THEME CALENDAR STYLES ===== */
    
    /* Base Variables for Consistency */
    :root {
        --primary-blue: #3b82f6;
        --primary-blue-dark: #2563eb;
        --primary-emerald: #059669;
        --primary-emerald-dark: #047857;
        --primary-purple: #7c3aed;
        --primary-purple-dark: #6d28d9;
        --sage-green: #588157;
        --sage-green-dark: #4a6b49;
        --soft-rose: #ffafcc;
        --soft-rose-dark: #ff9cbf;
        --background-light: #f8fafc;
        --background-white: #ffffff;
        --text-primary: #1f2937;
        --text-secondary: #6b7280;
        --text-muted: #9ca3af;
        --border-light: #e5e7eb;
        --border-medium: #d1d5db;
        --shadow-sm: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
        --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
        --radius-sm: 0.5rem;
        --radius-md: 0.75rem;
        --radius-lg: 1rem;
        --transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        
        /* Font System */
        --font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, sans-serif;
        --font-size-xs: 0.75rem;    /* 12px */
        --font-size-sm: 0.875rem;   /* 14px */
        --font-size-base: 1rem;     /* 16px */
        --font-size-lg: 1.125rem;   /* 18px */
        --font-size-xl: 1.25rem;    /* 20px */
        --font-size-2xl: 1.5rem;    /* 24px */
        --font-size-3xl: 1.875rem;  /* 30px */
        --font-size-4xl: 2.25rem;   /* 36px */
        --font-weight-normal: 400;
        --font-weight-medium: 500;
        --font-weight-semibold: 600;
        --font-weight-bold: 700;
        --line-height-tight: 1.25;
        --line-height-normal: 1.5;
        --line-height-relaxed: 1.625;
    }

    /* Base Typography - Force consistent font across ALL elements */
    * {
        font-family: var(--font-family) !important;
    }
    
    .calendar-app {
        font-size: var(--font-size-base);
        line-height: var(--line-height-normal);
        font-weight: var(--font-weight-normal);
    }

    /* Mobile-First Responsive Design */
    @media (max-width: 700px) {
        .calendar-app,
        .calendar-main,
        .calendar-section,
        .calendar-grid {
            max-width: 100vw !important;
            width: 100vw !important;
            min-width: 0 !important;
            padding: 0 !important;
        }
        .calendar-title {
            font-size: var(--font-size-3xl) !important;
            padding: 0.75rem 1rem !important;
        }
        .calendar-section {
            padding: 0.75rem !important;
            height: 80vh !important;
        }
        .calendar-grid {
            grid-template-columns: 45px repeat(7, 1fr) !important;
            font-size: var(--font-size-sm) !important;
            height: 55vh !important;
        }
        .calendar-sidebar.time-column {
            width: 45px !important;
            min-width: 45px !important;
            max-width: 45px !important;
        }
        .calendar-day-header {
            padding: 10px 0 6px 0 !important;
        }
        .calendar-day-number {
            font-size: var(--font-size-xl) !important;
        }
        .calendar-legend-item.legend-button {
            min-width: 85px !important;
            font-size: var(--font-size-xs) !important;
            padding: 4px 8px !important;
            gap: 0.25rem !important;
        }
        .calendar-month-header {
            margin-bottom: 1rem !important;
        }
        .calendar-month-header > div:first-child {
            margin-bottom: 0.75rem !important;
        }
        .legend-circle {
            width: 16px !important;
            height: 16px !important;
        }
        .booking-modal-content {
            padding: 1.5rem 1rem 1.25rem 1rem !important;
            max-width: 95vw !important;
        }
        .modal-header h3 {
            font-size: var(--font-size-2xl) !important;
        }
        .modal-details-grid {
            padding: 1rem !important;
            font-size: var(--font-size-base) !important;
        }
        .modal-close-btn {
            top: 12px !important;
            right: 12px !important;
        }
    }
    /* ===== MAIN LAYOUT ===== */
    .calendar-app {
        width: 100vw;
        max-width: 100vw;
        min-height: 100vh;
        margin: 0;
        padding: 0;
        background: var(--background-light);
        display: flex;
        flex-direction: column;
        align-items: center;
        font-family: var(--font-family);
    }
    .calendar-header {
        background: rgba(255, 255, 255, 0.95);
                border-radius: var(--radius-lg);
        box-shadow: var(--shadow-lg);
        border: 1px solid var(--border-light);
        max-width: 1100px;
        width: 100%;
        margin: 2rem auto 1.5rem;
        padding: 1.5rem;
        position: relative;
    }
    .calendar-main {
        width: 100%;
        max-width: 1100px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 0 1rem;
    }
    .calendar-section {
        width: 100%;
        max-width: 1100px;
        height: 70vh;
        margin: 0 auto;
        padding: 1.5rem;
        box-sizing: border-box;
        background: var(--background-white);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-lg);
        border: 1px solid var(--border-light);
        display: flex;
        flex-direction: column;
    }
    .calendar-grid {
        width: 100%;
        height: 60vh;
        display: grid;
        grid-template-columns: 70px repeat(7, 1fr);
        grid-auto-rows: auto;
        border: 1px solid var(--border-light);
        border-radius: var(--radius-md);
        overflow: auto;
        background: var(--background-white);
        box-sizing: border-box;
        flex: 1;
    }

    :global(body),
    :global(html),
    :global(#app) {
        width: 100vw;
        max-width: 100vw;
        margin: 0;
        padding: 0;
        overflow-x: hidden;
        background: var(--background-light);
        font-family: var(--font-family) !important;
    }

    /* Ensure all form elements use consistent font */
    :global(input),
    :global(select),
    :global(textarea),
    :global(button) {
        font-family: var(--font-family) !important;
    }

    /* ===== BUTTON SYSTEM ===== */
    .btn-base {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        font-family: var(--font-family);
        font-weight: var(--font-weight-semibold);
        border-radius: var(--radius-md);
        cursor: pointer;
        border: none;
        text-decoration: none;
        outline: none;
        position: relative;
        overflow: hidden;
    }

    .btn-base:focus {
        outline: 2px solid transparent;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }

    .btn-base:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .btn-base svg {
        flex-shrink: 0;
    }

    /* Icon sizing consistency */
    .btn-sm svg {
        width: 1rem;
        height: 1rem;
    }

    .btn-md svg {
        width: 1rem;
        height: 1rem;
    }

    .btn-lg svg {
        width: 1.125rem;
        height: 1.125rem;
    }

    .btn-nav-icon svg {
        width: 1.25rem;
        height: 1.25rem;
    }

    /* Loading spinner */
    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }

    .animate-spin {
        animation: spin 1s linear infinite;
    }

    /* Button Sizes */
    .btn-sm {
        padding: 0.5rem 1rem;
        font-size: var(--font-size-sm);
        min-height: 2rem;
    }

    .btn-md {
        padding: 0.625rem 1.25rem;
        font-size: var(--font-size-base);
        min-height: 2.5rem;
    }

    .btn-lg {
        padding: 0.75rem 1.5rem;
        font-size: var(--font-size-base);
        min-height: 3rem;
    }

    /* Button Variants */
    .btn-primary {
        background: linear-gradient(135deg, var(--primary-emerald) 0%, var(--primary-emerald-dark) 100%);
        color: white;
        box-shadow: var(--shadow-sm);
    }

    .btn-primary:hover:not(:disabled) {
        background: linear-gradient(135deg, var(--primary-emerald-dark) 0%, #047857 100%);
    }

    .btn-secondary {
        background: var(--background-white);
        color: var(--text-secondary);
        border: 1px solid var(--border-medium);
        box-shadow: var(--shadow-sm);
    }

    .btn-secondary:hover:not(:disabled) {
        background: var(--background-light);
        color: var(--text-primary);
        border-color: var(--primary-blue);
    }

    .btn-danger {
        background: #dc2626;
        color: white;
        box-shadow: var(--shadow-sm);
    }

    .btn-danger:hover:not(:disabled) {
        background: #b91c1c;
    }

    .btn-ghost {
        background: transparent;
        color: var(--text-secondary);
        border: 1px solid transparent;
    }

    .btn-ghost:hover:not(:disabled) {
        background: var(--background-light);
        color: var(--text-primary);
    }

    .btn-nav-icon {
        width: 2.5rem;
        height: 2.5rem;
        padding: 0;
        background: var(--background-white);
        color: var(--text-secondary);
        border: 1px solid var(--border-medium);
        box-shadow: var(--shadow-sm);
    }

    .btn-nav-icon:hover:not(:disabled) {
        background: #f9fafb;
        color: var(--text-primary);
    }

    /* Specific Navigation Styles (keeping existing behavior) */
    .calendar-nav-today {
        background: white !important;
        color: var(--primary-emerald) !important;
        border: 2px solid var(--primary-emerald-dark) !important;
        box-shadow: var(--shadow-sm);
    }

    .calendar-nav-today:hover:not(:disabled) {
        background: var(--primary-emerald) !important;
        color: white !important;
    }

    .calendar-signout {
        background: linear-gradient(135deg, var(--primary-purple) 0%, var(--primary-purple-dark) 100%) !important;
        color: white !important;
        border: none !important;
        box-shadow: var(--shadow-sm);
    }

    .calendar-signout:hover:not(:disabled) {
        background: linear-gradient(135deg, var(--primary-purple-dark) 0%, #5b21b6 100%) !important;
    }
    /* ===== LEGEND STYLING ===== */
    .calendar-legend-item {
        background: var(--background-white);
        border-radius: var(--radius-md);
        border: 1px solid var(--border-light);
        padding: 10px 18px;
        min-width: 120px;
        text-align: center;
        font-size: var(--font-size-base);
        font-weight: var(--font-weight-medium);
        box-shadow: var(--shadow-sm);
        transition: var(--transition);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
    }
    .calendar-legend-item:hover {
        transform: translateY(-2px);
        box-shadow: var(--shadow-md);
        border-color: var(--primary-blue);
    }
    .calendar-signout {
        background: linear-gradient(135deg, var(--primary-purple) 0%, var(--primary-purple-dark) 100%) !important;
        font-weight: var(--font-weight-semibold);
        letter-spacing: 0.025em;
        box-shadow: var(--shadow-sm);
        transition: var(--transition);
        border: none;
    }
    .calendar-signout:hover {
        transform: translateY(-1px) !important;
        box-shadow: var(--shadow-md) !important;
        background: linear-gradient(135deg, var(--primary-purple-dark) 0%, #5b21b6 100%) !important;
    }
    /* ===== TYPOGRAPHY ===== */
    .calendar-title {
        color: var(--text-primary);
        font-weight: var(--font-weight-bold);
        letter-spacing: 0.025em;
        margin-bottom: 1rem;
        margin-top: 1rem;
        font-size: 2.5rem;
        text-align: center;
        line-height: 1.2;
    }
    .calendar-loading .border-blue-500 {
        border-color: var(--primary-blue) var(--border-light) var(--border-light) var(--border-light);
    }
    .calendar-error, .calendar-no-rooms {
        border-radius: var(--radius-md);
        font-size: var(--font-size-base);
        box-shadow: var(--shadow-md);
    }
    .calendar-error strong, .calendar-no-rooms strong {
        font-weight: var(--font-weight-semibold);
    }
    .calendar-month-header {
        margin-bottom: 2rem;
        margin-top: 1rem;
        display: flex;
        align-items: center;
        gap: 1.5rem;
        justify-content: space-between;
        padding: 0 1rem;
        flex-wrap: wrap;
    }

    .calendar-nav {
        display: flex !important;
        align-items: center !important;
        gap: 0.75rem !important;
        flex-shrink: 0;
        flex-wrap: nowrap !important;
    }
    .calendar-month {
        color: var(--text-primary);
        font-size: var(--font-size-2xl);
        font-weight: var(--font-weight-semibold);
        letter-spacing: 0.025em;
    }
    /* ===== CALENDAR GRID ===== */
    .calendar-corner {
        grid-column: 1;
        grid-row: 1;
        background: #f8fafc !important;
        border-bottom: 1px solid var(--border-light);
        border-right: 1px solid var(--border-light);
        border-radius: var(--radius-md) 0 0 0;
        position: sticky;
        top: 0;
        z-index: 21;
    }
    .calendar-day-header {
        grid-row: 1;
        padding: 16px 0 12px 0;
        text-align: center;
        background: #f8fafc !important;
        border-bottom: 1px solid var(--border-light);
        border-right: 1px solid var(--border-light);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        position: sticky;
        top: 0;
        z-index: 20;
    }
    .calendar-day-name {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        font-weight: var(--font-weight-medium);
        letter-spacing: 0.05em;
        text-transform: uppercase;
    }
    .calendar-day-number {
        font-size: var(--font-size-2xl);
        font-weight: var(--font-weight-bold);
        color: var(--text-primary);
        margin-top: 4px;
    }
    .today {
        background: linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, #f8fafc 100%) !important;
        border-bottom: 2px solid var(--primary-blue) !important;
    }
    .today .calendar-day-number {
        color: var(--primary-blue);
        font-weight: var(--font-weight-bold);
    }
    .weekend {
        background: #f1f5f9 !important;
    }
    .calendar-sidebar.time-column {
        grid-column: 1;
        grid-row: 2 / span 96;
        display: grid;
        grid-template-rows: repeat(96, 15px);
        background: #f8fafc;
        border-right: 2px solid var(--border-medium);
        width: 70px;
        min-width: 70px;
        max-width: 70px;
        overflow: hidden;
        position: sticky;
        left: 0;
        top: 56px;
        z-index: 19;
    }
    .calendar-time-label {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        padding-right: 10px;
        height: 15px !important;
        min-height: 15px !important;
        max-height: 15px !important;
        box-sizing: border-box !important;
        border-top: 1px solid var(--border-light);
        font-size: var(--font-size-xs);
        color: var(--text-muted);
        white-space: nowrap;
        line-height: 15px;
        background: transparent;
        font-weight: var(--font-weight-medium);
    }
    .hour-label {
        border-top: 2px solid var(--border-medium);
        font-weight: var(--font-weight-semibold);
        color: var(--text-secondary);
        background: transparent;
    }
    .minute-label {
        border-top: 1px solid rgba(229, 231, 235, 0.8);
        color: var(--text-muted);
        background: transparent;
        opacity: 0.7;
    }
    .calendar-day.day-column {
        display: grid;
        grid-template-rows: repeat(96, 15px);
        border-right: 1px solid var(--border-medium);
        min-width: 0;
        background: var(--background-white);
    }
    .time-cell {
        position: relative;
        border-bottom: 1px solid rgba(229, 231, 235, 0.5);
        min-height: 15px;
        height: 15px;
        background: transparent;
        cursor: pointer;
        border-radius: 0;
    }
    .hour-start {
        border-top: 2px solid var(--border-medium) !important;
        border-bottom: 1px solid var(--border-light) !important;
    }
    .time-cell:hover {
        background: rgba(59, 130, 246, 0.08);
        border-radius: var(--radius-sm);
    }
    .today-column .time-cell {
        background: rgba(59, 130, 246, 0.03);
    }
    .today-column .time-cell:hover {
        background: rgba(59, 130, 246, 0.12);
    }
    .weekend-column .time-cell {
        background: rgba(241, 245, 249, 0.5);
    }
    .weekend-column .time-cell:hover {
        background: rgba(203, 213, 225, 0.3);
    }
    /* ===== BOOKING DISPLAY ===== */
    .booking-display {
        position: absolute;
        border-radius: var(--radius-md);
        padding: 8px 12px;
        font-size: var(--font-size-sm);
        color: white;
        z-index: 10;
        overflow: hidden;
        box-shadow: var(--shadow-md);
        display: flex;
        flex-direction: column;
        background: linear-gradient(135deg, var(--primary-blue) 0%, var(--primary-blue-dark) 100%);
        border: 1px solid rgba(255,255,255,0.2);
        box-sizing: border-box;
        min-height: 15px;
    }
    .booking-title {
        font-family: var(--font-family);
        font-weight: var(--font-weight-semibold);
        font-size: var(--font-size-sm);
        line-height: var(--line-height-tight);
        color: white;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        width: 100%;
        margin-bottom: 2px;
    }
    .booking-user {
        font-family: var(--font-family);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-normal);
        line-height: var(--line-height-tight);
        color: rgba(255, 255, 255, 0.9);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        width: 100%;
        font-weight: var(--font-weight-medium);
    }
    .drag-selection {
        position: absolute;
        left: 3px;
        right: 3px;
        background: rgba(59, 130, 246, 0.15);
        border: 2px dashed var(--primary-blue);
        border-radius: var(--radius-md);
        z-index: 5;
        pointer-events: none;
        opacity: 0.7;
            }
    /* ===== MODAL STYLES ===== */
    .booking-modal-overlay {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0, 0, 0, 0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
    }
    .booking-modal-content {
        background: var(--background-white);
        border-radius: var(--radius-lg);
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        padding: 2rem 2.5rem 2rem 2.5rem;
        width: 100%;
        max-width: 32rem;
        max-height: calc(100vh - 4rem);
        overflow-y: auto;
        color: var(--text-primary);
        position: relative;
        border: 1px solid var(--border-light);
    }
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
    .booking-modal-content input,
    .booking-modal-content select,
    .booking-modal-content textarea {
        font-size: var(--font-size-base);
        padding: 0.75rem;
        background: var(--background-white);
        color: var(--text-primary);
        border: 2px solid var(--border-light);
        border-radius: var(--radius-md);
        margin-bottom: 0.5rem;
        font-weight: var(--font-weight-medium);
    }
    .booking-modal-content input:focus,
    .booking-modal-content select:focus,
    .booking-modal-content textarea:focus {
        border: 2px solid var(--primary-blue);
        background: #fafbfb;
        outline: none;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }
    .booking-modal-content button {
        font-size: var(--font-size-base);
        font-weight: var(--font-weight-semibold);
        border-radius: var(--radius-md);
        border: none;
    }
    .modal-close-btn {
        position: absolute;
        top: 20px;
        right: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-muted);
        background: transparent;
        border: none;
        cursor: pointer;
        padding: 8px;
        border-radius: var(--radius-md);
    }
    .modal-close-btn:hover {
        color: var(--text-primary);
        background: var(--background-light);
    }
    .modal-header {
        padding: 1.5rem 1.5rem 0 1.5rem;
        margin-bottom: 1rem;
        border-bottom: 1px solid var(--border-light);
        padding-bottom: 0.75rem;
    }
    .modal-header h3 {
        font-size: var(--font-size-2xl);
        font-weight: var(--font-weight-bold);
        color: var(--text-primary);
        margin: 0;
        letter-spacing: 0.025em;
        text-align: center;
    }
    .modal-form {
        padding: 0 1.5rem 1.5rem 1.5rem;
        font-family: var(--font-family);
    }
    .modal-form > div {
        margin-bottom: 1rem;
    }
    .modal-form label {
        display: block;
        font-size: var(--font-size-base);
        color: var(--text-secondary);
        font-weight: var(--font-weight-semibold);
        margin-bottom: 0.5rem;
        letter-spacing: 0.025em;
    }
    .modal-input {
        width: 100%;
        font-family: var(--font-family);
        font-size: var(--font-size-base);
        line-height: var(--line-height-normal);
        padding: 0.75rem;
        background: white;
        border: 1px solid var(--border-medium);
        border-radius: var(--radius-md);
        color: var(--text-primary);
    }
    .modal-input:focus {
        outline: none;
        border-color: var(--primary-emerald);
        box-shadow: 0 0 0 3px rgba(5, 150, 105, 0.1);
    }
    .modal-date-value {
        font-family: var(--font-family);
        font-size: var(--font-size-base);
        font-weight: var(--font-weight-medium);
        color: var(--text-primary);
        line-height: var(--line-height-normal);
    }
    .modal-form input, .modal-form select, .modal-form textarea {
        font-family: var(--font-family);
        font-size: var(--font-size-base);
        line-height: var(--line-height-normal);
    }
    .modal-form .modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.75rem;
        padding-top: 1rem;
        margin-top: 1rem;
        border-top: 1px solid var(--border-light);
        margin-left: -1.5rem;
        margin-right: -1.5rem;
        padding-left: 1.5rem;
        padding-right: 1.5rem;
    }
    .modal-form .modal-actions button {
        font-size: var(--font-size-base);
        font-weight: var(--font-weight-semibold);
        border-radius: var(--radius-md);
        padding: 0.75rem 1.5rem;
        border: none;
        cursor: pointer;
        transition: var(--transition);
        min-width: 100px;
    }
    .modal-form .modal-actions button:last-child {
        background: linear-gradient(135deg, var(--primary-emerald) 0%, var(--primary-emerald-dark) 100%);
        color: white;
        box-shadow: var(--shadow-sm);
    }
    .modal-form .modal-actions button:last-child:hover {
        background: var(--primary-emerald-dark);
        box-shadow: var(--shadow-md);
        transform: translateY(-1px);
    }
    .modal-form .modal-actions button:first-child {
        background: var(--background-light);
        border: 1px solid var(--border-medium);
        color: var(--text-secondary);
    }
    .modal-form .modal-actions button:first-child:hover {
        background: var(--border-medium);
        color: var(--text-primary);
    }
    .modal-success-content {
        padding: 2rem;
        font-family: var(--font-family) !important;
    }
    .modal-success-title {
        font-size: var(--font-size-2xl);
        font-weight: var(--font-weight-bold);
        color: var(--text-primary);
        font-family: var(--font-family) !important;
        letter-spacing: 0.025em;
        margin: 0;
    }
    .modal-success-text {
        color: var(--text-secondary);
        font-size: var(--font-size-base);
        font-family: var(--font-family) !important;
        line-height: var(--line-height-normal);
        font-weight: var(--font-weight-medium);
        margin: 0;
    }
    .modal-error {
        background: #fef2f2;
        border: 1px solid #fecaca;
        color: #dc2626;
        border-radius: var(--radius-md);
        font-size: var(--font-size-base);
        font-family: var(--font-family);
        margin-bottom: 1rem;
        padding: 1rem;
        line-height: var(--line-height-normal);
    }
    .modal-details-grid {
        background: var(--background-white);
        border: 1px solid var(--border-light);
        border-radius: var(--radius-md);
        padding: 1.5rem;
        margin: 1rem 0;
        box-shadow: var(--shadow-sm);
        font-size: var(--font-size-base);
        line-height: var(--line-height-relaxed);
    }
    .modal-icon {
        color: var(--text-secondary);
        font-family: var(--font-family);
    }
    .modal-value {
        color: var(--text-primary);
        font-family: var(--font-family);
        font-weight: var(--font-weight-medium);
        font-size: var(--font-size-base);
        line-height: var(--line-height-normal);
    }
    .modal-details {
        padding: 0 2rem;
        font-family: var(--font-family);
    }
    .modal-delete {
        margin: 1.5rem 2rem 2rem 2rem;
        padding: 1.5rem 0 0 0;
        border-top: 1px solid var(--border-light);
    }
    .modal-delete button {
        background: #dc2626;
        color: white;
        font-weight: var(--font-weight-bold);
        border-radius: var(--radius-md);
        transition: var(--transition);
        font-size: var(--font-size-base);
        font-family: var(--font-family);
        border: none;
        cursor: pointer;
        padding: 0.75rem 1.5rem;
        width: 100%;
    }
    .modal-delete button:hover {
        background: #b91c1c;
        transform: translateY(-1px);
        box-shadow: var(--shadow-md);
    }
    /* ===== ROOM-SPECIFIC COLORS ===== */
    .room-green {
        color: white !important;
        background: var(--sage-green) !important;
        box-shadow: 0 4px 12px rgba(132, 204, 22, 0.3);
    }
    .room-lovelace {
        background: var(--soft-rose) !important;
        color: white !important;
        box-shadow: 0 4px 12px rgba(244, 114, 182, 0.3);
    }
    .room-green-text {
        color: var(--sage-green-dark) !important;
    }
    .room-lovelace-text {
        color: var(--soft-rose-dark) !important;
    }
    .room-green-border {
        border-color: var(--sage-green) !important;
    }
    .room-lovelace-border {
        border-color: var(--soft-rose) !important;
    }
    .room-selected {
        border: 2px solid var(--primary-emerald) !important;
        box-shadow: var(--shadow-md);
        transform: scale(1.02);
        opacity: 1 !important;
    }
    .room-selected svg {
        color: var(--primary-emerald);
    }
    .room-unselected {
        opacity: 0.8;
        border: 2px solid var(--border-medium);
        background: var(--background-white);
        color: var(--text-primary);
    }
    .room-unselected:hover {
        opacity: 1;
        border: 2px solid var(--primary-blue);
        box-shadow: var(--shadow-md);
    }
    .calendar-legend-item.legend-button {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        border-radius: var(--radius-md);
        border: 1px solid var(--border-light);
        background: rgba(255, 255, 255, 0.8);
                box-shadow: var(--shadow-sm);
        padding: 6px 12px;
        min-width: auto;
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        cursor: default;
        transition: var(--transition);
        gap: 0.5rem;
        color: var(--text-primary);
    }
    .legend-circle {
        display: inline-block;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        margin-right: 0;
        border: 1px solid white;
        box-shadow: var(--shadow-sm);
        background: linear-gradient(135deg, var(--primary-blue) 0%, var(--primary-blue-dark) 100%);
        flex-shrink: 0;
    }
    .circle-green {
        background: var(--sage-green);
        border-color: white;
        box-shadow: 0 2px 4px rgba(101, 163, 13, 0.3);
    }
    .circle-lovelace {
        background: var(--soft-rose);
        border-color: white;
        box-shadow: 0 2px 4px rgba(236, 72, 153, 0.3);
    }
    
    /* ===== FOOTER STYLES ===== */
    .recurse-footer {
        margin-top: 3rem;
        margin-bottom: 2rem;
    }
    .recurse-footer span {
        color: #000000 !important;
    }
    .recurse-link {
        color: #059669 !important;
        text-decoration: underline;
        text-decoration-color: #059669;
        transition: all 0.2s ease;
    }
    .recurse-link:hover {
        color: #047857 !important;
        text-decoration-color: #047857;
    }
    .recurse-logo {
    }
    
    /* ===== FINAL TOUCHES ===== */
    * {
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
    }
    
    .calendar-section::-webkit-scrollbar {
        width: 8px;
    }
    .calendar-section::-webkit-scrollbar-track {
        background: var(--background-light);
        border-radius: 4px;
    }
    .calendar-section::-webkit-scrollbar-thumb {
        background: var(--border-medium);
        border-radius: 4px;
    }
    .calendar-section::-webkit-scrollbar-thumb:hover {
        background: var(--text-muted);
    }
</style>
