class ApexStudio < Formula
  desc "Cognitive Architecture & Actuation IDE Engine"
  homepage "https://github.com/nileshchakraborty/apex-studio"
  url "https://github.com/nileshchakraborty/apex-studio/archive/refs/tags/v1.0.0.tar.gz"
  sha256 "d6ab26021984ac8bbf1d2a6de3708e9b0f4238242fac2504476166d367000bae"
  license "MIT"
  head "https://github.com/nileshchakraborty/apex-studio.git", branch: "main"

  depends_on "node" => :recommended
  depends_on "python@3.12"

  def install
    # 1. Place engine code into libexec
    libexec.install "engine"
    libexec.install "APEX_CONFIG.json" if File.exist?("APEX_CONFIG.json")
    libexec.install "product.json" if File.exist?("product.json")

    # 2. Setup Python virtual environment in libexec/venv
    python3 = Formula["python@3.12"].opt_bin/"python3.12"
    system python3, "-m", "venv", libexec/"venv"

    # 3. Install Python dependencies
    system libexec/"venv/bin/pip", "install", "--upgrade", "pip"
    system libexec/"venv/bin/pip", "install",
           "ddgs==9.16.1",
           "beautifulsoup4>=4.12.0",
           "fastapi>=0.110.0",
           "uvicorn>=0.28.0",
           "requests>=2.31.0",
           "pydantic>=2.6.0"

    # 4. Install VS Code extension package to share
    pkgshare.install "apex-studio.vsix" if File.exist?("apex-studio.vsix")
    pkgshare.install "extensions/apex-studio" if Dir.exist?("extensions/apex-studio")

    # 5. Create wrapper CLI binaries in bin
    (bin/"apex-studio").write <<~EOS
      #!/usr/bin/env bash
      export PYTHONPATH="#{libexec}:$PYTHONPATH"
      exec "#{libexec}/venv/bin/python3" -m engine.cli "$@"
    EOS
    chmod 0755, bin/"apex-studio"

    (bin/"apex-engine").write <<~EOS
      #!/usr/bin/env bash
      export PYTHONPATH="#{libexec}:$PYTHONPATH"
      exec "#{libexec}/venv/bin/python3" -m engine.server "$@"
    EOS
    chmod 0755, bin/"apex-engine"
  end

  def post_install
    # Clean macOS quarantine flags on installed binaries and scripts
    system "/usr/bin/xattr", "-d", "com.apple.quarantine", bin/"apex-studio" if File.exist?(bin/"apex-studio")
    system "/usr/bin/xattr", "-d", "com.apple.quarantine", bin/"apex-engine" if File.exist?(bin/"apex-engine")
    if File.exist?(pkgshare/"apex-studio.vsix")
      system "/usr/bin/xattr", "-d", "com.apple.quarantine", pkgshare/"apex-studio.vsix"
    end
  rescue StandardError
    # Ignore if quarantine attribute is absent
    nil
  end

  service do
    run [opt_bin/"apex-engine"]
    keep_alive true
    log_path var/"log/apex-studio.log"
    error_log_path var/"log/apex-studio.error.log"
    working_dir var
    environment_variables APEX_PORT: "8000"
  end

  def caveats
    <<~EOS
      ========================================================================
         Apex Studio: Cognitive Invariant AI IDE Engine Installed!
      ========================================================================

      1. Install the Apex Studio extension into VS Code or Cursor:
         code --install-extension #{opt_pkgshare}/apex-studio.vsix
         # or for Cursor:
         cursor --install-extension #{opt_pkgshare}/apex-studio.vsix

      2. Start the Apex Studio background daemon:
         brew services start apex-studio
         # Or run in foreground:
         apex-engine

      3. Use the CLI directly from any terminal:
         apex-studio models
         apex-studio set-model --suite mistral
         apex-studio plan "Your feature prompt"
         apex-studio act --all

      4. Verify that Ollama is running locally:
         ollama list
      ========================================================================
    EOS
  end

  test do
    assert_match "Apex Studio", shell_output("#{bin}/apex-studio --help")
  end
end
