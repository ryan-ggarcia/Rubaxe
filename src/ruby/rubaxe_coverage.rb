# Loaded by Rubaxe through RUBYOPT: line coverage with the stdlib Coverage module (what SimpleCov uses), no gems needed.
# Each process writes <pid>.json into RUBAXE_COVERAGE, so forked or parallel test workers don't overwrite each other.
require 'coverage'

Coverage.start(lines: true)

at_exit do
  require 'json' # only now: loading it early would activate a json gem before the project's Bundler setup
  root = "#{Dir.pwd}/"
  skip = %w[spec/ test/ vendor/ tmp/].map { |d| root + d }
  data = Coverage.result.each_with_object({}) do |(file, cov), out|
    out[file] = cov[:lines] if file.start_with?(root) && skip.none? { |s| file.start_with?(s) }
  end
  File.write(File.join(ENV.fetch('RUBAXE_COVERAGE'), "#{Process.pid}.json"), JSON.generate(data))
end
