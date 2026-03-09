-- ============================================================
-- BUS BOOKING PLATFORM - COMPLETE DATABASE SCHEMA
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20),
    password_hash VARCHAR(255) NOT NULL,
    is_verified BOOLEAN DEFAULT FALSE,
    is_blocked BOOLEAN DEFAULT FALSE,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- OPERATORS
-- ============================================================
CREATE TABLE IF NOT EXISTS operators (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20),
    password_hash VARCHAR(255) NOT NULL,
    company_name VARCHAR(255),
    gst_number VARCHAR(50),
    license_number VARCHAR(100),
    is_verified BOOLEAN DEFAULT FALSE,
    is_approved BOOLEAN DEFAULT FALSE,
    is_blocked BOOLEAN DEFAULT FALSE,
    rating DECIMAL(3,2) DEFAULT 0.00,
    total_ratings INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ADMINS
-- ============================================================
CREATE TABLE IF NOT EXISTS admins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'admin',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- BUSES
-- ============================================================
CREATE TABLE IF NOT EXISTS buses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
    bus_name VARCHAR(255) NOT NULL,
    bus_number VARCHAR(50) UNIQUE NOT NULL,
    bus_type VARCHAR(50) NOT NULL CHECK (bus_type IN ('AC','NON_AC','SLEEPER','SEMI_SLEEPER','VOLVO','LUXURY')),
    seating_type VARCHAR(20) NOT NULL CHECK (seating_type IN ('SEATER','SLEEPER','BOTH')),
    total_seats INTEGER NOT NULL,
    amenities JSONB DEFAULT '[]',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ROUTES
-- ============================================================
CREATE TABLE IF NOT EXISTS routes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
    source_city VARCHAR(255) NOT NULL,
    destination_city VARCHAR(255) NOT NULL,
    distance_km DECIMAL(10,2),
    duration_minutes INTEGER,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SCHEDULES
-- ============================================================
CREATE TABLE IF NOT EXISTS schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bus_id UUID NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
    route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
    departure_time TIMESTAMPTZ NOT NULL,
    arrival_time TIMESTAMPTZ NOT NULL,
    price_per_seat DECIMAL(10,2) NOT NULL,
    available_seats INTEGER NOT NULL,
    total_seats INTEGER NOT NULL,
    status VARCHAR(20) DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED')),
    boarding_points JSONB DEFAULT '[]',
    dropping_points JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SEATS
-- ============================================================
CREATE TABLE IF NOT EXISTS seats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    schedule_id UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
    seat_number VARCHAR(10) NOT NULL,
    seat_type VARCHAR(20) DEFAULT 'SEATER' CHECK (seat_type IN ('SEATER','SLEEPER')),
    deck VARCHAR(10) DEFAULT 'LOWER' CHECK (deck IN ('LOWER','UPPER')),
    status VARCHAR(20) DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','BOOKED','BLOCKED')),
    price DECIMAL(10,2),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(schedule_id, seat_number)
);

-- ============================================================
-- BOOKINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS bookings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_reference VARCHAR(20) UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id),
    schedule_id UUID NOT NULL REFERENCES schedules(id),
    operator_id UUID NOT NULL REFERENCES operators(id),
    seats_booked JSONB NOT NULL DEFAULT '[]',
    passenger_details JSONB NOT NULL DEFAULT '[]',
    total_amount DECIMAL(10,2) NOT NULL,
    promo_code VARCHAR(50),
    promo_discount DECIMAL(10,2) DEFAULT 0,
    final_amount DECIMAL(10,2) NOT NULL,
    boarding_point VARCHAR(255),
    dropping_point VARCHAR(255),
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','CANCELLED','COMPLETED','FAILED')),
    payment_status VARCHAR(20) DEFAULT 'PENDING' CHECK (payment_status IN ('PENDING','PAID','REFUNDED','FAILED')),
    cancellation_reason TEXT,
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TICKETS
-- ============================================================
CREATE TABLE IF NOT EXISTS tickets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    ticket_number VARCHAR(20) UNIQUE NOT NULL,
    passenger_name VARCHAR(255) NOT NULL,
    passenger_age INTEGER,
    passenger_gender VARCHAR(10),
    seat_number VARCHAR(10) NOT NULL,
    status VARCHAR(20) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED','USED')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- WALLETS
-- ============================================================
CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID NOT NULL,
    owner_type VARCHAR(20) NOT NULL CHECK (owner_type IN ('USER','OPERATOR','ADMIN')),
    balance DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    currency VARCHAR(10) DEFAULT 'INR',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(owner_id, owner_type)
);

-- ============================================================
-- TRANSACTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id UUID NOT NULL REFERENCES wallets(id),
    type VARCHAR(20) NOT NULL CHECK (type IN ('CREDIT','DEBIT')),
    amount DECIMAL(15,2) NOT NULL,
    balance_before DECIMAL(15,2) NOT NULL,
    balance_after DECIMAL(15,2) NOT NULL,
    reference_id UUID,
    reference_type VARCHAR(50),
    description TEXT,
    status VARCHAR(20) DEFAULT 'SUCCESS' CHECK (status IN ('SUCCESS','FAILED','PENDING')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PROMO CODES
-- ============================================================
CREATE TABLE IF NOT EXISTS promo_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    type VARCHAR(20) NOT NULL CHECK (type IN ('GLOBAL','USER_SPECIFIC')),
    discount_type VARCHAR(20) NOT NULL CHECK (discount_type IN ('FLAT','PERCENTAGE','CREDITS')),
    discount_value DECIMAL(10,2) NOT NULL,
    max_discount DECIMAL(10,2),
    min_booking_amount DECIMAL(10,2) DEFAULT 0,
    usage_limit INTEGER,
    used_count INTEGER DEFAULT 0,
    user_id UUID REFERENCES users(id),
    valid_from TIMESTAMPTZ NOT NULL,
    valid_until TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID NOT NULL REFERENCES admins(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PROMO REDEMPTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS promo_redemptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    promo_id UUID NOT NULL REFERENCES promo_codes(id),
    user_id UUID NOT NULL REFERENCES users(id),
    booking_id UUID REFERENCES bookings(id),
    discount_applied DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- RATINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS ratings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id UUID NOT NULL REFERENCES bookings(id),
    user_id UUID NOT NULL REFERENCES users(id),
    operator_id UUID NOT NULL REFERENCES operators(id),
    bus_id UUID NOT NULL REFERENCES buses(id),
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    review TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    level VARCHAR(20) NOT NULL CHECK (level IN ('info','warn','error','debug')),
    service VARCHAR(100) NOT NULL,
    message TEXT NOT NULL,
    meta JSONB DEFAULT '{}',
    user_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- OTP VERIFICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS otp_verifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL,
    otp VARCHAR(10) NOT NULL,
    type VARCHAR(30) NOT NULL CHECK (type IN ('SIGNUP','BOOKING','LOGIN','PASSWORD_RESET')),
    expires_at TIMESTAMPTZ NOT NULL,
    is_used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_operators_email ON operators(email);
CREATE INDEX IF NOT EXISTS idx_bookings_user_id ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_schedule_id ON bookings(schedule_id);
CREATE INDEX IF NOT EXISTS idx_bookings_reference ON bookings(booking_reference);
CREATE INDEX IF NOT EXISTS idx_schedules_route_id ON schedules(route_id);
CREATE INDEX IF NOT EXISTS idx_schedules_departure ON schedules(departure_time);
CREATE INDEX IF NOT EXISTS idx_seats_schedule ON seats(schedule_id);
CREATE INDEX IF NOT EXISTS idx_transactions_wallet ON transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_verifications(email);
CREATE INDEX IF NOT EXISTS idx_logs_service ON logs(service);
CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);

-- ============================================================
-- SEED: DEFAULT ADMIN
-- ============================================================
INSERT INTO admins (name, email, password_hash, role)
VALUES ('Super Admin', 'admin@busplatform.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LxuM6NzB3H9JcIkPi', 'super_admin')
ON CONFLICT (email) DO NOTHING;

-- ============================================================
-- SEED: ADMIN WALLET (10 Crore = 1,000,000,000 credits)
-- ============================================================
INSERT INTO wallets (owner_id, owner_type, balance)
SELECT id, 'ADMIN', 1000000000.00
FROM admins WHERE email = 'admin@busplatform.com'
ON CONFLICT (owner_id, owner_type) DO NOTHING;

-- ============================================================
-- FUNCTION: Auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE OR REPLACE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_operators_updated_at BEFORE UPDATE ON operators FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_buses_updated_at BEFORE UPDATE ON buses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_routes_updated_at BEFORE UPDATE ON routes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_schedules_updated_at BEFORE UPDATE ON schedules FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_bookings_updated_at BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_wallets_updated_at BEFORE UPDATE ON wallets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
