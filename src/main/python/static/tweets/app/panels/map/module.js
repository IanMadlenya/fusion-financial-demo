/*

  ## Map

  ### Parameters
  * map :: 'world', 'us' or 'europe'
  * colors :: an array of colors to use for the regions of the map. If this is a 2
              element array, jquerymap will generate shades between these colors
  * size :: How big to make the facet. Higher = more countries
  * exclude :: Exlude the array of counties
  * spyable :: Show the 'eye' icon that reveals the last Solr query
  * index_limit :: This does nothing yet. Eventually will limit the query to the first
                   N indices

*/

define([
  'angular',
  'app',
  'underscore',
  'jquery',
  './lib/jquery.jvectormap.min'
],
function (angular, app, _, $) {
  'use strict';

  var module = angular.module('kibana.panels.map', []);
  app.useModule(module);

  module.controller('map', function($scope, $rootScope, querySrv, dashboard, filterSrv) {
    $scope.panelMeta = {
      editorTabs : [
        {title:'Queries', src:'app/partials/querySelect.html'}
      ],
      modals : [
        {
          description: "Inspect",
          icon: "icon-info-sign",
          partial: "app/partials/inspector.html",
          show: $scope.panel.spyable
        }
      ],
      status  : "Stable",
      description : "Displays a map of shaded regions using a field containing a 2 letter country "+
       ", or US state, code. Regions with more hit are shaded darker. Node that this does use the"+
       " Solr terms facet, so it is important that you set it to the correct field."
    };

    // Set and populate defaults
    var _d = {
      queries     : {
        mode        : 'all',
        ids         : [],
        query       : '*:*',
        custom      : ''
      },
      map     : "world",
      colors  : ['#A0E2E2', '#265656'],
      size    : 100,
      exclude : [],
      spyable : true,
      index_limit : 0
    };
    _.defaults($scope.panel,_d);

    $scope.init = function() {
      $scope.$on('refresh',function(){$scope.get_data();});
      $scope.get_data();
    };

    $scope.set_refresh = function (state) {
      $scope.refresh = state;
    };

    $scope.close_edit = function() {
      if ($scope.refresh) {
        $scope.get_data();
      }
      $scope.refresh = false;
      $scope.$emit('render');
    };

    $scope.get_data = function() {

      // Make sure we have everything for the request to complete
      if(dashboard.indices.length === 0) {
        return;
      }
      $scope.panelMeta.loading = true;


      var request;
      request = $scope.sjs.Request().indices(dashboard.indices);

      $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);
      // This could probably be changed to a BoolFilter
      var boolQuery = $scope.ejs.BoolQuery();
      _.each($scope.panel.queries.ids,function(id) {
        boolQuery = boolQuery.should(querySrv.getEjsObj(id));
      });

      // Then the insert into facet and make the request
      request = request
        .facet($scope.ejs.TermsFacet('map')
          .field($scope.panel.field)
          .size($scope.panel.size)
          .exclude($scope.panel.exclude)
          .facetFilter($scope.ejs.QueryFilter(
            $scope.ejs.FilteredQuery(
              boolQuery,
              filterSrv.getBoolFilter(filterSrv.ids)
              )))).size(0);

      $scope.populate_modal(request);

      // Build Solr query
      var start_time = new Date(filterSrv.list[0].from).toISOString();
      var end_time = new Date(filterSrv.list[0].to).toISOString();
      // Get time field from filterSrv, is the time field always at list[0]?
      var time_field = filterSrv.list[0].field;
      var fq = '&fq=' + time_field + ':[' + start_time + '%20TO%20' + end_time + ']';  // Get timefield from filterSrv
      var df = '&df=message';
      var wt_json = '&wt=json';
      var rows_limit = '&rows=0'; // for map module, we don't display results from row, but we use facets.
      // var facet_gap = '%2B1DAY';
      var facet = '&facet=true' +
                  '&facet.field=' + $scope.panel.field +
                  '&facet.limit=' + $scope.panel.size;
      var filter_fq = '';
      var filter_either = [];

      // Apply filters to the query
      _.each(filterSrv.list, function(v,k) {
        // Skip the timestamp filter because it's already applied to the query using fq param.
        // timestamp filter should be in k = 0
        if (k > 0 && v.field != time_field && v.active) {
          if (DEBUG) { console.log('terms: k=',k,' v=',v); }
          if (v.mandate == 'must') {
            filter_fq = filter_fq + '&fq=' + v.field + ':"' + v.value + '"';
          } else if (v.mandate == 'mustNot') {
            filter_fq = filter_fq + '&fq=-' + v.field + ':"' + v.value + '"';
          } else if (v.mandate == 'either') {
            filter_either.push(v.field + ':"' + v.value + '"');
          }
        }
      });
      // parse filter_either array values, if exists
      if (filter_either.length > 0) {
        filter_fq = filter_fq + '&fq=(' + filter_either.join(' OR ') + ')';
      }

      // Set the panel's query
      $scope.panel.queries.query = 'q=' + querySrv.list[0].query + df + wt_json + fq + rows_limit + facet + filter_fq;

      // Set the additional custom query
      if ($scope.panel.queries.custom != null) {
        // request = request.customQuery($scope.panel.queries.custom);
        request = request.setQuery($scope.panel.queries.query + $scope.panel.queries.custom);
      } else {
        request = request.setQuery($scope.panel.queries.query);
      }

      console.debug('map: $scope.panel=',$scope.panel);

      var results = request.doSearch();

      // Populate scope when we have results
      results.then(function(results) {
        $scope.panelMeta.loading = false;
        // $scope.hits = results.hits.total;
        $scope.hits = results.response.numFound;
        $scope.data = {};
        // _.each(results.facets.map.terms, function(v) {
        //   $scope.data[v.term.toUpperCase()] = v.count;
        // });
        console.debug('map: results=',results);

        var terms = results.facet_counts.facet_fields[$scope.panel.field];

        if ($scope.hits > 0) {
          for (var i=0; i < terms.length; i += 2) {
            if (terms[i+1] > 0) {
              $scope.data[terms[i]] = terms[i+1];
            }
          };
        }

        $scope.$emit('render');
      });
    };

    // I really don't like this function, too much dom manip. Break out into directive?
    $scope.populate_modal = function(request) {
      $scope.inspector = angular.toJson(JSON.parse(request.toString()),true);
    };

    $scope.build_search = function(field,value) {
      filterSrv.set({type:'querystring',mandate:'must',query:field+":"+value});
      dashboard.refresh();
    };

  });


  module.directive('map', function() {
    return {
      restrict: 'A',
      link: function(scope, elem) {

        elem.html('<center><img src="img/load_big.gif"></center>');

        // Receive render events
        scope.$on('render',function(){
          render_panel();
        });

        // Or if the window is resized
        angular.element(window).bind('resize', function(){
          render_panel();
        });

        function render_panel() {
          elem.text('');
          $('.jvectormap-zoomin,.jvectormap-zoomout,.jvectormap-label').remove();
          require(['./panels/map/lib/map.'+scope.panel.map], function () {
            elem.vectorMap({
              map: scope.panel.map,
              regionStyle: {initial: {fill: '#8c8c8c'}},
              zoomOnScroll: false,
              backgroundColor: null,
              series: {
                regions: [{
                  values: scope.data,
                  scale: scope.panel.colors,
                  normalizeFunction: 'polynomial'
                }]
              },
              onRegionLabelShow: function(event, label, code){
                elem.children('.map-legend').show();
                var count = _.isUndefined(scope.data[code]) ? 0 : scope.data[code];
                elem.children('.map-legend').text(label.text() + ": " + count);
              },
              onRegionOut: function() {
                $('.map-legend').hide();
              },
              onRegionClick: function(event, code) {
                var count = _.isUndefined(scope.data[code]) ? 0 : scope.data[code];
                if (count !== 0) {
                  scope.build_search(scope.panel.field,code);
                }
              }
            });
            elem.prepend('<span class="map-legend"></span>');
            $('.map-legend').hide();
          });
        }
      }
    };
  });
});