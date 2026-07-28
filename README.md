# PresetHub – Lightroom Preset Marketplace

A full‑stack web application where users can browse, download, upload, and review Lightroom presets. Built with Node.js, Express, LowDB, and vanilla JavaScript.

## ✨ Features

- **User Authentication** – Signup/Login with JWT
- **Preset CRUD** – Upload, view, update, delete presets
- **File Upload** – Supports `.xmp`, `.dng`, `.lrtemplate` files
- **Advanced Search** – Smart search with relevance scoring
- **Filters & Sorting** – Category, price, rating, popularity
- **Reviews & Ratings** – User reviews with helpful votes
- **Wishlist** – Save favorite presets
- **Creator Dashboard** – Profile management, follow system
- **Admin Panel** – User management, preset approval, analytics
- **Payment Integration** – Razorpay for paid presets
- **PWA Support** – Offline capable, installable on mobile
- **Dark Mode** – Theme toggle

## 🛠️ Tech Stack

- **Backend**: Node.js + Express + LowDB
- **Frontend**: Vanilla JS + CSS3 + HTML5
- **Payment**: Razorpay
- **PWA**: Service Worker + Manifest
- **Security**: Helmet, Rate Limiting, Input Validation

## 📦 Installation

### Prerequisites
- Node.js (v16+)
- npm or yarn

### Setup

1. **Clone the repository**
```bash
git clone <your-repo-url>
cd presethub