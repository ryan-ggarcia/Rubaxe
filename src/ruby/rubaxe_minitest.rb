# Loaded by Rubaxe through RUBYOPT on Minitest runs: reports each test result as JSON to RUBAXE_TEST_REPORT.
# The `bundle exec` launcher also sees RUBYOPT; activating minitest there would clash with the Gemfile's version.
return if File.basename($0, '.*').match?(/\Abundler?\z/)

require 'json'
require 'minitest'

module Minitest
  class RubaxeReporter < AbstractReporter
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
      File.write(ENV.fetch('RUBAXE_TEST_REPORT'), JSON.generate(@results))
    end
  end

  def self.plugin_rubaxe_init(_options)
    reporter << RubaxeReporter.new
  end
end

# Minitest 6 no longer discovers plugins on its own, so register by name (also works on 5.x).
Minitest.extensions << 'rubaxe' unless Minitest.extensions.include?('rubaxe')
