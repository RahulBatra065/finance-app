from datetime import datetime
from sqlalchemy import Column, Integer, Float, String, Text, DateTime
from database import Base


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    sha256_hash = Column(String, unique=True, index=True)
    amount = Column(Float)
    currency = Column(String, default="INR")
    direction = Column(String)  # debit / credit
    vendor = Column(String)
    bank = Column(String)
    account_last4 = Column(String)
    date = Column(String)
    upi_ref = Column(String)
    category = Column(String)
    raw_text = Column(Text)
    source_type = Column(String)
    file_path = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    payment_method = Column(String, nullable=True)  # upi | debit_card | credit_card | net_banking | cash
    amortise_months = Column(Integer, nullable=True)  # spread cost over N months (e.g. 12 for annual gym)
    created_at = Column(DateTime, default=datetime.utcnow)


class Category(Base):
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True)
    monthly_budget = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class VendorMapping(Base):
    __tablename__ = "vendor_mappings"

    id = Column(Integer, primary_key=True, index=True)
    keyword = Column(String)
    category = Column(String)


class Holding(Base):
    __tablename__ = "holdings"

    id = Column(String, primary_key=True)  # UUID
    name = Column(String)
    type = Column(String)  # mutual_fund | stock
    units_or_shares = Column(Float)
    average_buy_price = Column(Float)
    buy_date = Column(String)
    notes = Column(Text, nullable=True)
    scheme_code = Column(String, nullable=True)   # for mutual funds
    ticker = Column(String, nullable=True)         # for stocks
    current_price = Column(Float, nullable=True)
    last_updated = Column(DateTime, nullable=True)


class SplitExpense(Base):
    __tablename__ = "split_expenses"

    id = Column(Integer, primary_key=True, index=True)
    transaction_id = Column(Integer, index=True)   # FK to transactions.id
    total_people = Column(Integer)                  # including you
    amount_owed = Column(Float)                     # total others owe you = amount * (people-1)/people
    amount_received = Column(Float, default=0.0)
    notes = Column(Text, nullable=True)             # e.g. "Dinner with Priya, Arjun"
    status = Column(String, default="pending")      # pending | partial | settled
    created_at = Column(DateTime, default=datetime.utcnow)
    settled_at = Column(DateTime, nullable=True)


class AppSettings(Base):
    __tablename__ = "app_settings"

    key = Column(String, primary_key=True)
    value = Column(Text)
