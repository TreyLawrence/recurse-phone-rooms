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
        return durationMinutes ;
    }

    // Load data

     async function retry() {
        console.log("retrying")
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

        // Scroll to current time on initial load
        setTimeout(() => {
            const calendarGrid = document.querySelector(".calendar-grid");
            if (calendarGrid) {
                // Calculate scrollTop for current time
                // Each hour = 60px, each minute = 1px (15min slot = 15px)
                const now = new Date();
                const scrollTop = now.getHours() * 60 + now.getMinutes();
                calendarGrid.scrollTop = scrollTop;
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
        if (!room) return "#4f46e5"; // Default color if room not found

        // Assign specific colors based on room name
        if (room.name.toLowerCase().includes("green")) {
            return "linear-gradient(90deg, #16a34a 60%, #15803d 100%)"; // Green color for Green Phone Room
        } else if (room.name.toLowerCase().includes("lovelace")) {
            return "linear-gradient(90deg, #ec4899 60%, #f472b6 100%)"; // Pink color for Lovelace
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
</script>

<div class="calendar-app bg-gray-900 min-h-screen text-white overflow-x-hidden flex flex-col items-center w-full">
    

    <!-- Legend and Title Group -->
    <div class="calendar-above-grid w-full max-w-[1100px] flex flex-col items-center mb-4">

        <h1 class="calendar-title text-3xl font-bold text-center mb-2 mt-2 tracking-tight"
            style="
                background: linear-gradient(90deg, #60a5fa 0%, #a78bfa 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                text-fill-color: transparent;
                letter-spacing: 0.04em;
                padding: 0.5rem 1.5rem;
                border-radius: 0.75rem;
                box-shadow: 0 2px 16px 0 rgba(96,165,250,0.10);
                font-size: 2.5rem;
                font-weight: 800;
                margin-bottom: 0.5rem;
                margin-top: 0.5rem;
                text-align: center;
                line-height: 1.1;
            "
        >
            <svg xmlns="http://www.w3.org/2000/svg" class="inline-block align-middle mr-2" width="36" height="36" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="vertical-align: middle; filter: drop-shadow(0 2px 8px #60a5fa88);">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            Phone Room Calendar
        </h1>
    </div>

    <main class="calendar-main w-full max-w-[1100px] px-4 py-2 flex flex-col items-center">
        {#if isLoading}
            <div class="calendar-loading flex justify-center my-10">
                <div class="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
        {:else if error}
            <div class="calendar-error bg-red-900 border border-red-700 text-red-100 px-4 py-3 rounded relative mb-4">
                <strong class="font-bold">Error!</strong>
                <span class="block sm:inline">{error}</span>
                <button class="bg-red-800 text-white px-4 py-2 rounded-md mt-2" on:click={retry}>Retry</button>
            </div>
        {:else if rooms.length === 0}
            <div class="calendar-no-rooms bg-yellow-900 border border-yellow-700 text-yellow-100 px-4 py-3 rounded relative mb-4">
                <strong class="font-bold">No Rooms Available</strong>
                <span class="block sm:inline">No phone rooms were found in the system.</span>
            </div>
        {:else}
            <section class="calendar-section bg-gray-900 border border-gray-800 rounded-lg p-2 ml-2 w-full max-w-[1100px]" style="height: 70vh;">
                <header class="calendar-month-header mb-4 flex items-center gap-4 justify-between px-2">
                    <h2 class="calendar-month text-xl font-semibold text-white tracking-tight">
                        {new Date(weekDays[0]).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                    </h2>
                    <div class="calendar-nav flex items-center gap-2 ml-2">
                        <button
                            on:click={goToToday}
                            class="calendar-nav-today px-4 py-2 bg-gray-800 text-white rounded-md hover:bg-gray-700"
                        >
                            Today
                        </button>
                        <button
                            on:click={prevWeek}
                            class="calendar-nav-prev w-10 h-10 bg-gray-700 text-white rounded-md hover:bg-gray-600 flex items-center justify-center"
                            aria-label="Previous Week"
                        >
                            ←
                        </button>
                        <button
                            on:click={nextWeek}
                            class="calendar-nav-next w-10 h-10 bg-gray-700 text-white rounded-md hover:bg-gray-600 flex items-center justify-center"
                            aria-label="Next Week"
                        >
                            →
                        </button>
                        <button
                        on:click={handleSignOut}
                        class="calendar-signout px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-md text-white text-sm absolute right-0 top-1/2 -translate-y-1/2"
                        style="background-color: #2563eb !important;"
                    >
                        Sign Out
                    </button>
                    </div>
                </header>
                <div class="calendar-grid" style="width: 100%; max-width: 1100px; height: 60vh;">
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
            <!-- Move the legend here, below the calendar grid -->
            <div class="calendar-legend flex items-center gap-4 mb-3 w-full justify-center relative mt-4">
                {#each rooms as room}
                    <div
                        class="calendar-legend-item legend-button flex items-center justify-center"
                        style="box-shadow: 0 1px 3px rgba(0,0,0,0.5); border-radius: 4px; padding: 2px 14px; min-width: 110px; text-align: center; gap: 0.75rem;"
                    >
                        <span class="legend-circle {room.name.toLowerCase().includes('green') ? 'circle-green' : room.name.toLowerCase().includes('lovelace') ? 'circle-lovelace' : ''}" aria-hidden="true"></span>
                        <span class="text-sm font-medium" style="color: #fff; text-shadow: 0px 1px 2px rgba(0,0,0,0.5);">{room.name}</span>
                    </div>
                {/each}
            </div>
        {/if}
    </main>

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
                <div class="modal-success text-center py-6">
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-12 h-12 mx-auto text-green-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                    </svg>
                    <h3 class="text-xl font-medium text-white mb-2">Meeting scheduled</h3>
                    <p class="text-gray-300">Your booking has been confirmed</p>
                    <button on:click={closeBookingForm} class="mt-4 inline-flex justify-center px-4 py-2 text-sm font-medium text-blue-400 hover:text-blue-300">Close</button>
                </div>
            {:else}
                <div class="modal-header pt-8 mb-4">
                    <h3 class="text-xl font-medium text-white text-center">Book a Room</h3>
                </div>
                <form on:submit|preventDefault={handleBookingSubmit} class="modal-form space-y-4">
                    <div class="modal-date flex items-center gap-2 mb-4">
                        <div class="text-gray-400">
                            <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                        </div>
                        <div class="text-white font-medium">{selectedDate ? formatDate(selectedDate) : ""}</div>
                    </div>
                    <div class="modal-time mb-4">
                        <label class="block text-gray-400 mb-2">Start Time</label>
                        <select bind:value={selectedStartTime} class="w-full bg-gray-700 border-none rounded-md focus:ring-1 focus:ring-blue-500 p-2 text-white">
                            {#each hours as hour}
                                {#each [0, 15, 30, 45] as minute}
                                    <option value={`${hour}:${minute === 0 ? "00" : minute}`}>{formatTime(hour, minute)}</option>
                                {/each}
                            {/each}
                        </select>
                    </div>
                    <div class="modal-duration mb-4">
                        <label class="block text-gray-400 mb-2">Duration</label>
                        <select bind:value={selectedDuration} class="w-full bg-gray-700 border-none rounded-md focus:ring-1 focus:ring-blue-500 p-2 text-white">
                            <option value="15">15 minutes</option>
                            <option value="30">30 minutes</option>
                            <option value="45">45 minutes</option>
                            <option value="60">1 hour</option>
                            <option value="90">1 hour 30 minutes</option>
                            <option value="120">2 hours</option>
                        </select>
                    </div>
                    <div class="modal-room mb-4">
                        <label class="block text-gray-400 mb-2">Select Room</label>
                        <div class="flex space-x-3">
                            {#each rooms as room}
                                <button
                                    type="button"
                                    on:click={() => (selectedRoomId = room.id)}
                                    class="flex-1 py-3 px-4 text-center rounded-md transition-colors font-medium {room.name.toLowerCase().includes('green') ? 'room-green' : room.name.toLowerCase().includes('lovelace') ? 'room-lovelace' : ''} {selectedRoomId === room.id ? 'room-selected' : 'room-unselected'}"
                                    aria-pressed={selectedRoomId === room.id}
                                >
                                    {room.name}
                                    {#if selectedRoomId === room.id}
                                        <svg class="inline ml-2 align-middle text-blue-300" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
                                    {/if}
                                </button>
                            {/each}
                        </div>
                    </div>
                    <div class="modal-notes mb-4">
                        <label class="block text-gray-400 mb-2">Notes (optional)</label>
                        <textarea bind:value={bookingNotes} class="w-full bg-gray-700 border-none rounded-md p-2 text-white focus:ring-1 focus:ring-blue-500 resize-none" rows="2" placeholder="Add description"></textarea>
                    </div>
                    {#if bookingError}
                        <div class="modal-error bg-red-900 border border-red-700 text-white px-4 py-3 rounded">
                            <strong class="font-bold">Error:</strong>
                            <span class="block sm:inline">{bookingError}</span>
                        </div>
                    {/if}
                    <div class="modal-actions flex justify-end pt-4 border-t border-gray-700 space-x-3">
                        <button type="button" on:click={closeBookingForm} class="px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700 rounded-md">Cancel</button>
                        <button type="submit" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md shadow-sm" disabled={isSubmitting || !selectedRoomId}>{isSubmitting ? "Saving..." : "Book Room"}</button>
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
            <div class="modal-header pt-8 mb-4">
                <h3 class="text-xl font-medium text-white text-center">Booking Details</h3>
            </div>
            {#if selectedBooking}
                <div class="modal-details space-y-4">
                    <div class="modal-details-grid grid grid-cols-[auto,1fr] gap-4 items-center">
                        <div class="text-gray-400">
                            <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                            </svg>
                        </div>
                        <div class="text-white">
                            {#if selectedBooking}
                                {rooms.find((r) => r.id === selectedBooking?.room_id)?.name || "Unknown Room"}
                            {:else}
                                Unknown Room
                            {/if}
                        </div>
                        <div class="text-gray-400">
                            <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                        </div>
                        <div class="text-white">{formatDate(new Date(selectedBooking.start_time))}</div>
                        <div class="text-gray-400">
                            <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </div>
                        <div class="text-white">{formatTimeFromDate(selectedBooking.start_time)} - {formatTimeFromDate(selectedBooking.end_time)}</div>
                        <div class="text-gray-400">
                            <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                        </div>
                        <div class="text-white">{selectedBooking.user_name || "Unknown User"}</div>
                        {#if selectedBooking.notes}
                            <div class="text-gray-400 self-start pt-2">
                                <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                            </div>
                            <div class="text-white pb-2">{selectedBooking.notes}</div>
                        {/if}
                    </div>
                    {#if $user && parseInt($user.id) === selectedBooking.user_id}
                        <div class="modal-delete pt-4 border-t border-gray-700">
                            <button on:click={confirmDeleteBooking} class="w-full mt-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-md shadow-sm" disabled={isSubmitting}>{isSubmitting ? "Deleting..." : "Delete Booking"}</button>
                        </div>
                    {/if}
                </div>
            {/if}
        </div>
    </div>
</div>

<style>
    /* Responsive adjustments for mobile */
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
            font-size: 1.5rem !important;
            padding: 0.25rem 0.5rem !important;
        }
        .calendar-section {
            padding: 0.5rem !important;
            height: 80vh !important;
        }
        .calendar-grid {
            grid-template-columns: 40px repeat(7, 1fr) !important;
            font-size: 0.85rem !important;
            height: 55vh !important;
        }
        .calendar-sidebar.time-column {
            width: 40px !important;
            min-width: 40px !important;
            max-width: 40px !important;
        }
        .calendar-day-header {
            padding: 8px 0 4px 0 !important;
        }
        .calendar-day-number {
            font-size: 1.1rem !important;
        }
        .calendar-legend-item.legend-button {
            min-width: 70px !important;
            font-size: 0.85rem !important;
            padding: 4px 8px !important;
        }
        .legend-circle {
            width: 14px !important;
            height: 14px !important;
        }
        .booking-modal-content {
            padding: 1.2rem 0.5rem 1rem 0.5rem !important;
            max-width: 98vw !important;
        }
        .modal-header h3 {
            font-size: 1.05rem !important;
        }
        .modal-details-grid {
            padding: 0.5rem !important;
            font-size: 0.95rem !important;
        }
        .modal-close-btn {
            top: 8px !important;
            right: 8px !important;
        }
    }
    /* Modern, clean calendar grid layout */
    .calendar-app {
        width: 100vw;
        max-width: 100vw;
        min-height: 100vh;
        margin: 0;
        padding: 0;
        background: #181c24;
        display: flex;
        flex-direction: column;
        align-items: center;
    }
    .calendar-header {
        background: rgba(24, 28, 36, 0.98);
        border-radius: 0.75rem;
        box-shadow: 0 2px 12px 0 rgba(0,0,0,0.10);
        border: 1px solid #23272f;
        max-width: 1100px;
        width: 100%;
        margin-left: auto;
        margin-right: auto;
        position: static;
        left: unset;
        right: unset;
        top: unset;
        transform: none;
        z-index: 100;
        margin-top: 2.5rem;
        margin-bottom: 1.5rem;
        padding-top: 1.25rem;
        padding-bottom: 1.25rem;
    }
    .calendar-main {
        width: 100%;
        max-width: 1100px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        align-items: center;
    }
    .calendar-section {
        width: 100%;
        max-width: 1100px;
        height: 70vh;
        margin: 0 auto;
        padding: 1px;
        box-sizing: border-box;
        border-left: none;
        border-right: none;
        background: transparent;
    }
    .calendar-grid {
        width: 100%;
        max-width: 1100px;
        height: 60vh;
        margin: 0 auto;
        display: grid;
        grid-template-columns: 60px repeat(7, 1fr);
        grid-auto-rows: auto;
        border: 1px solid #23272f;
        border-radius: 0.75rem;
        overflow: auto;
        background: linear-gradient(135deg, #181c24 0%, #23272f 100%);
        box-sizing: border-box;
        border-left: none;
        border-right: none;
    }

    :global(body),
    :global(html),
    :global(#app) {
        width: 100vw;
        max-width: 100vw;
        margin: 0;
        padding: 0;
        overflow-x: hidden;
        background: #181c24;
    }

    .calendar-header {
        background: rgba(24, 28, 36, 0.98);
        border-radius: 0.75rem;
        box-shadow: 0 2px 12px 0 rgba(0,0,0,0.10);
        border: 1px solid #23272f;
    }

    .calendar-nav-today {
        background: linear-gradient(90deg, #2563eb 60%, #1e40af 100%);
        color: #fff;
        font-weight: 600;
        letter-spacing: 0.02em;
        box-shadow: 0 1px 2px rgba(37,99,235,0.08);
        transition: background 0.2s;
    }
    .calendar-nav-today:hover {
        background: #1e40af;
    }
    .calendar-nav-prev, .calendar-nav-next {
        background: #23272f;
        color: #fff;
        font-size: 1.25rem;
        border: none;
        box-shadow: 0 1px 2px rgba(0,0,0,0.08);
        transition: background 0.2s;
    }
    .calendar-nav-prev:hover, .calendar-nav-next:hover {
        background: #374151;
    }
    .calendar-legend-item {
        background: linear-gradient(90deg, #23272f 60%, #181c24 100%);
        border-radius: 6px;
        border: 1px solid #374151;
        padding: 4px 16px;
        min-width: 100px;
        text-align: center;
        font-size: 1rem;
        font-weight: 500;
        box-shadow: 0 1px 3px rgba(0,0,0,0.10);
        margin-right: 0.5rem;
    }
    .calendar-signout {
        background: linear-gradient(90deg, #2563eb 60%, #1e40af 100%) !important;
        font-weight: 600;
        letter-spacing: 0.02em;
        box-shadow: 0 1px 2px rgba(37,99,235,0.08);
        transition: background 0.2s;
    }
    .calendar-signout:hover {
        background: #1e40af !important;
    }
    .calendar-title {
        color: #fff;
        font-weight: 700;
        letter-spacing: 0.01em;
        margin-bottom: 0.5rem;
        margin-top: 0.5rem;
        font-size: 2.1rem;
        text-align: center;
    }
    .calendar-loading .border-indigo-500 {
        border-color: #6366f1 #23272f #23272f #23272f;
    }
    .calendar-error, .calendar-no-rooms {
        border-radius: 0.5rem;
        font-size: 1rem;
        box-shadow: 0 2px 8px 0 rgba(0,0,0,0.10);
    }
    .calendar-error strong, .calendar-no-rooms strong {
        font-weight: 700;
    }
    .calendar-month-header {
        margin-bottom: 1.5rem;
        margin-top: 0.5rem;
        display: flex;
        align-items: center;
        gap: 1.5rem;
        justify-content: space-between;
        padding-left: 0.5rem;
        padding-right: 0.5rem;
    }
    .calendar-month {
        color: #e0e7ef;
        font-size: 1.25rem;
        font-weight: 600;
        letter-spacing: 0.01em;
    }
    .calendar-corner {
        grid-column: 1;
        grid-row: 1;
        background: #23272f !important;
        border-bottom: 1px solid #374151;
        border-right: 1px solid #374151;
        border-radius: 0.75rem 0 0 0;
        position: sticky;
        top: 0;
        z-index: 21;
    }
    .calendar-day-header {
        grid-row: 1;
        padding: 12px 0 8px 0;
        text-align: center;
        background: #23272f !important;
        border-bottom: 1px solid #374151;
        border-right: 1px solid #374151;
        border-radius: 0 0 0 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        position: sticky;
        top: 0;
        z-index: 20;
    }
    .calendar-day-name {
        font-size: 1rem;
        color: #a0aec0;
        font-weight: 600;
        letter-spacing: 0.01em;
    }
    .calendar-day-number {
        font-size: 1.5rem;
        font-weight: 700;
        color: #fff;
        margin-top: 2px;
    }
    .today {
        background: linear-gradient(90deg, #2563eb22 0%, #23272f 100%);
    }
    .weekend {
        background: #23272f;
    }
    .calendar-sidebar.time-column {
        grid-column: 1;
        grid-row: 2 / span 96;
        display: grid;
        grid-template-rows: repeat(96, 15px);
        background: #181c24;
        border-right: 1px solid #23272f;
        width: 60px;
        min-width: 60px;
        max-width: 60px;
        overflow: hidden;
        /* Make sticky on the left */
        position: sticky;
        left: 0;
        top: 48px; /* Height of the header row, adjust if needed */
        z-index: 19; /* Just below the header (20/21) */
        background: #181c24;
    }
    .calendar-time-label {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        padding-right: 8px;
        height: 15px !important;
        min-height: 15px !important;
        max-height: 15px !important;
        box-sizing: border-box !important;
        border-top: 1px solid #23272f;
        font-size: 0.8rem;
        color: #a0aec0;
        white-space: nowrap;
        line-height: 15px;
        background: transparent;
    }
    .hour-label {
        border-top: 1px solid #374151;
        font-weight: 600;
        color: #e0e7ef;
        background: transparent;
    }
    .minute-label {
        border-top: 1px solid #23272f;
        color: #a0aec0;
        background: transparent;
    }
    .calendar-day.day-column {
        display: grid;
        grid-template-rows: repeat(96, 15px);
        border-right: 1px solid #23272f;
        min-width: 0;
        width: calc((100vw - 60px) / 7);
        background: transparent;
    }
    .time-cell {
        position: relative;
        border-bottom: none;
        min-height: 15px;
        height: 15px;
        background: transparent;
        transition: background 0.2s;
        cursor: pointer;
        border-radius: 0.25rem;
    }
    .hour-start {
        border-top: 1px solid #374151;
    }
    .time-cell:hover {
        background: #2563eb22;
    }
    .today-column .time-cell {
        background: #2563eb11;
    }
    .weekend-column .time-cell {
        background: #23272f;
    }
    .booking-display {
        position: absolute;
        border-radius: 0.5rem;
        padding: 6px 10px;
        font-size: 0.92rem;
        color: #fff;
        z-index: 10;
        overflow: hidden;
        box-shadow: 0 2px 8px rgba(0,0,0,0.18);
        display: flex;
        flex-direction: column;
        background: linear-gradient(90deg, #2563eb 60%, #1e40af 100%);
        text-shadow: 0px 1px 2px rgba(0,0,0,0.25);
        border: 1px solid rgba(255,255,255,0.10);
        box-sizing: border-box;
        transition: box-shadow 0.2s, background 0.2s;
        min-height: 15px;
    }
    .booking-display:hover {
        box-shadow: 0 4px 16px rgba(37,99,235,0.18);
        background: linear-gradient(90deg, #1e40af 60%, #2563eb 100%);
    }
    .booking-title {
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: 1rem;
        line-height: 1.1;
        width: 100%;
    }
    .booking-user {
        font-size: 0.85rem;
        opacity: 0.85;
        font-style: italic;
        color: #dbeafe;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        width: 100%;
        line-height: 1.1;
    }
    .drag-selection {
        position: absolute;
        left: 2px;
        right: 2px;
        background: rgba(37,99,235,0.18);
        border: 2px dashed #2563eb;
        border-radius: 0.5rem;
        z-index: 5;
        pointer-events: none;
        animation: pulse 1.5s infinite;
    }
    @keyframes pulse {
        0% { opacity: 0.5; }
        50% { opacity: 0.8; }
        100% { opacity: 0.5; }
    }
    /* Modal styles - modern, clean, dark */
    .booking-modal-overlay {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(24, 28, 36, 0.85);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
    }
    .booking-modal-content {
        background: linear-gradient(135deg, #23272f 0%, #181c24 100%);
        border-radius: 1rem;
        box-shadow: 0 8px 32px 0 rgba(0,0,0,0.25);
        padding: 2.5rem 2rem 2rem 2rem;
        width: 100%;
        max-width: 28rem;
        max-height: calc(100vh - 4rem);
        overflow-y: auto;
        color: #fff;
        position: relative;
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
        font-size: 1rem;
        padding: 0.5rem;
        background: #23272f;
        color: #fff;
        border: 1px solid #374151;
        border-radius: 0.5rem;
        margin-bottom: 0.5rem;
        transition: border 0.2s, background 0.2s;
    }
    .booking-modal-content input:focus,
    .booking-modal-content select:focus,
    .booking-modal-content textarea:focus {
        border: 1.5px solid #2563eb;
        background: #181c24;
        outline: none;
    }
    .booking-modal-content button {
        font-size: 1rem;
        font-weight: 600;
        border-radius: 0.5rem;
        transition: background 0.2s, color 0.2s;
    }
    .modal-close-btn {
        position: absolute;
        top: 18px;
        right: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #a0aec0;
        background: transparent;
        border: none;
        cursor: pointer;
        padding: 6px;
        border-radius: 0.5rem;
        transition: color 0.2s, background 0.2s;
    }
    .modal-close-btn:hover {
        color: #fff;
        background: #23272f;
    }
    .modal-header h3 {
        font-size: 1.25rem;
        font-weight: 700;
        color: #fff;
        margin-bottom: 0.5rem;
    }
    .modal-form label {
        font-size: 0.95rem;
        color: #a0aec0;
        font-weight: 500;
        margin-bottom: 0.25rem;
    }
    .modal-form .modal-actions button {
        font-size: 1rem;
        font-weight: 600;
        border-radius: 0.5rem;
        padding: 0.5rem 1.25rem;
    }
    .modal-form .modal-actions button:last-child {
        background: linear-gradient(90deg, #2563eb 60%, #1e40af 100%);
        color: #fff;
        box-shadow: 0 1px 2px rgba(37,99,235,0.08);
    }
    .modal-form .modal-actions button:last-child:hover {
        background: #1e40af;
    }
    .modal-form .modal-actions button:first-child {
        background: #23272f;
        color: #a0aec0;
    }
    .modal-form .modal-actions button:first-child:hover {
        background: #374151;
        color: #fff;
    }
    .modal-success h3 {
        color: #22d3ee;
        font-weight: 700;
        font-size: 1.25rem;
    }
    .modal-success p {
        color: #a0aec0;
        font-size: 1rem;
    }
    .modal-error {
        background: #b91c1c;
        border: 1px solid #991b1b;
        color: #fff;
        border-radius: 0.5rem;
        font-size: 1rem;
        margin-bottom: 0.5rem;
    }
    .modal-details-grid {
        background: #23272f;
        border-radius: 0.5rem;
        padding: 1rem;
        box-shadow: 0 1px 4px rgba(0,0,0,0.10);
    }
    .modal-details-grid .text-white {
        color: #fff;
        font-weight: 500;
    }
    .modal-details-grid .text-gray-400 {
        color: #a0aec0;
    }
    .modal-delete button {
        background: #b91c1c;
        color: #fff;
        font-weight: 700;
        border-radius: 0.5rem;
        transition: background 0.2s;
    }
    .modal-delete button:hover {
        background: #991b1b;
    }
    /* Room-specific color classes for legend, booking, and selection */
    .room-green {
        color: #fff !important;
        background: linear-gradient(90deg, #16a34a 60%, #15803d 100%) !important;
    }
    .room-lovelace {
        background: linear-gradient(90deg, #ec4899 60%, #f472b6 100%) !important;
        color: #fff !important;
    }
    .room-green-text {
        color: #22c55e !important;
    }
    .room-lovelace-text {
        color: #ec4899 !important;
    }
    .room-green-border {
        border-color: #22c55e !important;
    }
    .room-lovelace-border {
        border-color: #f9a8d4 !important;
    }
    .room-selected {
        border: 2.5px solid #60a5fa !important;
        box-shadow: 0 0 0 3px #2563eb44;
        background: linear-gradient(90deg, #2563eb 60%, #1e40af 100%) !important;
        color: #fff !important;
        position: relative;
        z-index: 1;
    }
    .room-selected svg {
        color: #60a5fa;
    }
    .room-unselected {
        opacity: 0.85;
        filter: grayscale(0.15);
        border: 2px solid transparent;
        background: inherit;
        transition: opacity 0.2s, filter 0.2s, border 0.2s;
    }
    .room-unselected:hover {
        opacity: 1;
        filter: none;
        border: 2px solid #374151;
    }
    .calendar-legend-item.legend-button {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        border-radius: 0.75rem;
        border: 1.5px solid #374151;
        background: transparent;
        box-shadow: 0 1px 3px rgba(0,0,0,0.10);
        padding: 6px 18px;
        min-width: 110px;
        font-size: 1rem;
        font-weight: 500;
        margin-right: 0.5rem;
        cursor: default;
        transition: box-shadow 0.2s, border 0.2s;
        gap: 0.75rem;
    }
    .calendar-legend-item.legend-button:hover {
        box-shadow: 0 2px 8px rgba(37,99,235,0.10);
        border: 1.5px solid #2563eb;
    }
    .legend-circle {
        display: inline-block;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        margin-right: 0.5rem;
        border: 2.5px solid #23272f;
        box-shadow: 0 1px 2px rgba(0,0,0,0.10);
        background: #4f46e5; /* fallback default */
    }
    .circle-green {
        background: linear-gradient(90deg, #16a34a 60%, #15803d 100%);
        border-color: #22c55e;
    }
    .circle-lovelace {
        background: linear-gradient(90deg, #ec4899 60%, #f472b6 100%);
        border-color: #f9a8d4;
    }
</style>
