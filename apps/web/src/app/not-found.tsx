export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center">
        <p className="text-6xl md:text-7xl font-semibold tracking-tight text-accent-purple mb-4 tabular-nums">
          404
        </p>
        <h1 className="text-2xl font-semibold text-text-primary mb-2">
          Page not found
        </h1>
        <p className="text-text-secondary text-base mb-8">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <a
          href="/auth/login"
          className="bg-accent-purple text-white font-medium rounded-lg px-6 py-2.5 text-sm hover:bg-purple-600 transition-colors duration-200"
        >
          Go to login
        </a>
      </div>
    </main>
  );
}
