# Loaded by Rubaxe through RUBYOPT on Minitest runs: reports each test result as JSON to RUBAXE_TEST_REPORT.
# Requiring minitest or json here would activate the newest installed gem before the project's `bundler/setup`
# ("already activated json 3.1.0, but your Gemfile requires json 2.18.0"), so nothing is loaded now: the reporter
# is registered right after the project's own `require` brings Minitest in.
module RubaxeMinitest
  def self.register
    return if @done || !defined?(::Minitest::AbstractReporter)

    @done = true
    klass = Class.new(::Minitest::AbstractReporter) do
      def initialize
        super
        @results = []
      end

      def record(result)
        file, line = result.source_location
        status = result.skipped? ? 'pending' : result.passed? ? 'passed' : 'failed'
        @results << { file: file, line: line, name: result.name, group: result.klass, status: status, message: result.failure&.message, time: result.time }
      end

      def report
        require 'json' # by now Bundler has picked the project's version
        File.write(ENV.fetch('RUBAXE_TEST_REPORT'), JSON.generate(@results))
      end
    end
    ::Minitest.define_singleton_method(:plugin_rubaxe_init) { |_options| reporter << klass.new }
    # Minitest 6 no longer discovers plugins on its own, so register by name (also works on 5.x).
    ::Minitest.extensions << 'rubaxe' unless ::Minitest.extensions.include?('rubaxe')
  end
end

# Alias chain, like RubyGems and Zeitwerk: a module prepended to Kernel breaks when bundled_gems.rb aliases require.
module Kernel
  alias_method :rubaxe_original_require, :require

  private def require(path)
    rubaxe_original_require(path).tap { RubaxeMinitest.register }
  end
end
